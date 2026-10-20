// Loads the env file stack.mjs generated, then runs the full-cycle Playwright
// config. Values are read into this process's environment only - never printed.
//
//   node e2e/support/run-cycle.mjs [playwright args...]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const stackDir = path.resolve(process.env.E2E_STACK_DIR ?? path.join(tmpdir(), "kiakia-e2e-stack"));
const envFile = path.join(stackDir, "cycle.env");
if (!existsSync(envFile)) {
  console.error(`No stack env file at ${envFile}. Start the stack first: pnpm --filter web e2e:cycle:up`);
  process.exit(1);
}
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const result = spawnSync("pnpm", ["exec", "playwright", "test", "-c", "playwright.cycle.config.ts", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
