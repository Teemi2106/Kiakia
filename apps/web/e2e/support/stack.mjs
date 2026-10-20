/* eslint-disable no-console -- a CLI script: stdout is its interface */
// Brings up (and tears down) a THROWAWAY local Supabase stack for the
// full-cycle e2e run. It never touches the repo's own supabase/ workdir state
// and never reads apps/web/.env.local.
//
//   node e2e/support/stack.mjs up     start the stack + the monnify-webhook Edge Function
//   node e2e/support/stack.mjs down   stop it and delete its volumes (supabase stop --no-backup)
//   node e2e/support/stack.mjs env    print the path of the generated env file (never its contents)
//
// How it stays isolated:
//   * the supabase/ directory (config, migrations 0001-latest, seed, functions)
//     is COPIED into $E2E_STACK_DIR (default: <os tmp>/kiakia-e2e-stack) and the
//     copy's config.toml is rewritten with its own project_id and its own
//     ports (58xxx), so docker container/volume names cannot collide with a
//     developer's normal `supabase start` (project "kiakia", ports 543xx);
//   * every CLI call passes --workdir <that dir>, so nothing is linked to a
//     hosted project and `.temp/` state is not written into the repo;
//   * a fresh project means migrations + supabase/seed.sql run from scratch.
//
// Requires Docker. First run pulls images (can take several minutes).

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoSupabase = path.resolve(here, "../../../../supabase");
const stackDir = path.resolve(process.env.E2E_STACK_DIR ?? path.join(tmpdir(), "kiakia-e2e-stack"));
const envFile = path.join(stackDir, "cycle.env");
const functionsEnvFile = path.join(stackDir, "functions.env");
const functionsPidFile = path.join(stackDir, "functions.pid");

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "kiakia-e2ecycle";
const PORT_BASE = Number(process.env.E2E_PORT_BASE ?? 58320); // api=+1, db=+2, studio=+3, inbucket=+4, shadow=+0
const API_PORT = PORT_BASE + 1;
const MOCK_PORT = Number(process.env.MONNIFY_MOCK_PORT ?? 59080);
const WEBHOOK_SECRET = process.env.E2E_MONNIFY_SECRET ?? "e2e-local-monnify-secret";
const CLI = (process.env.SUPABASE_CLI ?? "npx -y supabase@2.121.0").split(" ");

// Refuse the one thing this script must never do.
if (PROJECT_ID === "kiakia" || [54321, 54322, 54323, 54324, 55321, 55322].includes(API_PORT)) {
  console.error("Refusing to use the default / another developer's project id or ports.");
  process.exit(1);
}

function cli(args, opts = {}) {
  return spawnSync(CLI[0], [...CLI.slice(1), ...args, "--workdir", stackDir], {
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: stackDir,
  });
}

function writeConfig() {
  rmSync(path.join(stackDir, "supabase"), { recursive: true, force: true });
  mkdirSync(stackDir, { recursive: true });
  cpSync(repoSupabase, path.join(stackDir, "supabase"), {
    recursive: true,
    filter: (src) => !/[\\/]\.(temp|branches)([\\/]|$)/.test(src),
  });
  const configPath = path.join(stackDir, "supabase", "config.toml");
  let toml = readFileSync(configPath, "utf8");
  const set = (re, to) => {
    if (!re.test(toml)) throw new Error(`config.toml no longer matches ${re} - update stack.mjs`);
    toml = toml.replace(re, to);
  };
  set(/^project_id = ".*"/m, `project_id = "${PROJECT_ID}"`);
  set(/^(\[api\][\s\S]*?^port = )\d+/m, `$1${API_PORT}`);
  set(/^(\[db\][\s\S]*?^port = )\d+/m, `$1${PORT_BASE + 2}`);
  set(/^shadow_port = \d+/m, `shadow_port = ${PORT_BASE}`);
  set(/^(\[studio\][\s\S]*?^port = )\d+/m, `$1${PORT_BASE + 3}`);
  set(/^(\[inbucket\][\s\S]*?^port = )\d+/m, `$1${PORT_BASE + 4}`);
  set(/^(\[studio\]\s*\n)enabled = true/m, `$1enabled = false`);
  set(/^(\[edge_runtime\]\s*\n)enabled = false/m, `$1enabled = true`);
  toml = toml.replaceAll("http://localhost:3000", process.env.E2E_BASE_URL ?? "http://localhost:3100");
  writeFileSync(configPath, toml);
}

async function waitFor(label, probe, timeoutMs) {
  const start = Date.now();
  for (;;) {
    try {
      if (await probe()) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function up() {
  writeConfig();
  console.log(`[stack] starting ${PROJECT_ID} (api :${API_PORT}) in ${stackDir}`);
  // stdout is captured, not echoed: `supabase start` prints the stack's API keys.
  const started = cli(["start", "-x", "studio,imgproxy,vector,logflare,pooler"], { capture: true });
  if (started.status !== 0) {
    console.error(String(started.stdout ?? "").replace(/(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(secret|publishable)_\w+)/g, "<redacted>"));
    throw new Error("supabase start failed");
  }

  const status = cli(["status", "-o", "env"], { capture: true });
  if (status.status !== 0) throw new Error("supabase status failed");
  const kv = Object.fromEntries(
    status.stdout
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z_0-9]+)="?(.*?)"?$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  const anon = kv.ANON_KEY ?? kv.PUBLISHABLE_KEY;
  const service = kv.SERVICE_ROLE_KEY ?? kv.SECRET_KEY;
  if (!anon || !service) throw new Error("supabase status did not report anon/service keys");

  // Edge Function env: the function reaches the mock Monnify through the
  // docker host gateway. MONNIFY_API_SECRET is the HMAC secret the webhook
  // signature is checked against - a test value that exists only here.
  writeFileSync(
    functionsEnvFile,
    [
      `MONNIFY_BASE_URL=http://host.docker.internal:${MOCK_PORT}`,
      `MONNIFY_API_KEY=e2e-api-key`,
      `MONNIFY_API_SECRET=${WEBHOOK_SECRET}`,
    ].join("\n") + "\n",
  );

  writeFileSync(
    envFile,
    [
      `E2E_SUPABASE_URL=http://127.0.0.1:${API_PORT}`,
      `E2E_SUPABASE_ANON_KEY=${anon}`,
      `E2E_SUPABASE_SERVICE_ROLE_KEY=${service}`,
      `E2E_MONNIFY_SECRET=${WEBHOOK_SECRET}`,
      `E2E_MONNIFY_MOCK_URL=http://127.0.0.1:${MOCK_PORT}`,
      `E2E_INBUCKET_URL=http://127.0.0.1:${PORT_BASE + 4}`,
      `E2E_WEBHOOK_URL=http://127.0.0.1:${API_PORT}/functions/v1/monnify-webhook`,
    ].join("\n") + "\n",
  );

  console.log("[stack] serving the monnify-webhook Edge Function");
  const out = path.join(stackDir, "functions.log");
  const child = spawn(
    CLI[0],
    [...CLI.slice(1), "functions", "serve", "--workdir", stackDir, "--env-file", functionsEnvFile],
    {
      cwd: stackDir,
      detached: true,
      stdio: ["ignore", openLog(out), openLog(out)],
      shell: process.platform === "win32",
    },
  );
  child.unref();
  writeFileSync(functionsPidFile, String(child.pid ?? ""));

  await waitFor(
    "the monnify-webhook function (an unsigned POST must answer 401)",
    async () => {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/functions/v1/monnify-webhook`, { method: "POST", body: "{}" });
      return res.status === 401;
    },
    240_000,
  );
  console.log(`[stack] ready. env file: ${envFile}`);
}

import { openSync } from "node:fs";
function openLog(file) {
  return openSync(file, "a");
}

function down() {
  if (existsSync(functionsPidFile)) {
    const pid = readFileSync(functionsPidFile, "utf8").trim();
    if (pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
      else {
        try {
          process.kill(-Number(pid));
        } catch {
          /* already gone */
        }
      }
    }
    rmSync(functionsPidFile, { force: true });
  }
  if (existsSync(path.join(stackDir, "supabase", "config.toml"))) {
    cli(["stop", "--no-backup"]);
  } else {
    console.log(`[stack] nothing to stop (no config in ${stackDir})`);
  }
}

const command = process.argv[2];
if (command === "up") {
  up().catch((error) => {
    console.error(`[stack] ${error.message}`);
    process.exit(1);
  });
} else if (command === "down") {
  down();
} else if (command === "env") {
  console.log(envFile);
} else {
  console.error("usage: node e2e/support/stack.mjs up|down|env");
  process.exit(2);
}
