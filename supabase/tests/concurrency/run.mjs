/* eslint-disable no-console -- a CLI: stdout is its interface */
// Multi-session concurrency harness for the sequential dispatch (migrations 0099-0106).
//
//   node run.mjs --db-url postgresql://postgres:postgres@127.0.0.1:58322/postgres [--only 1,2,9] [--scale 1]
//                [--keep-cron] [--no-cleanup] [--json out.json]
//
// It COMMITS rows. It therefore refuses to run against anything but the isolated e2e stack
// (db port 58322 by default). See README.md.
import { writeFileSync } from "node:fs";
import { Sess } from "./lib/db.mjs";
import { Fixtures } from "./lib/fixtures.mjs";
import { checkInvariants, INVARIANT_COUNT } from "./lib/invariants.mjs";
import { allScenarios } from "./scenarios/index.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
};
const dbUrl = opt("db-url", process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:58322/postgres");
const only = opt("only", null) ? String(opt("only")).split(",").map(Number) : null;
const scale = Number(opt("scale", 1));
const keepCron = Boolean(opt("keep-cron", false));
const noCleanup = Boolean(opt("no-cleanup", false));
const jsonOut = opt("json", null);

// ---- safety: committed rows only on the throwaway e2e stack --------------------------------------
const parsed = new URL(dbUrl);
const allowedPort = String(Number(process.env.E2E_PORT_BASE ?? 58320) + 2);
const isLocal = ["127.0.0.1", "localhost"].includes(parsed.hostname);
if (["54321", "54322", "54323", "5432"].includes(parsed.port) || !isLocal) {
  console.error(`Refusing ${parsed.hostname}:${parsed.port}: that is the normal dev / admintest / a remote database. The harness COMMITS rows.`);
  process.exit(2);
}
if (parsed.port !== allowedPort) {
  console.error(`Refusing port ${parsed.port}: the harness only runs on the isolated e2e stack (127.0.0.1:${allowedPort}). Start it with: pnpm --filter web e2e:cycle:up`);
  process.exit(2);
}

class Ctx {
  constructor(admin, pool, gate, fx, scenario) {
    this.admin = admin;
    this.pool = pool;
    this.gate = gate;
    this.fx = fx;
    this.scenario = scenario;
    this.failures = [];
    this.stats = {};
    this.iter = 0;
    this.url = dbUrl;
  }
  s(n) {
    return this.pool[n % this.pool.length];
  }
  check(cond, msg, detail) {
    if (!cond) this.failures.push({ iter: this.iter, msg, detail: detail === undefined ? undefined : safe(detail) });
    return Boolean(cond);
  }
  stat(k, n = 1) {
    this.stats[k] = (this.stats[k] ?? 0) + n;
  }
  note(k, v) {
    (this.stats[k] ??= []).push(v);
  }
}
const safe = (d) => {
  try {
    const t = JSON.stringify(d);
    return t.length > 700 ? t.slice(0, 700) + "..." : t;
  } catch {
    return String(d);
  }
};

async function newPool(n) {
  return Promise.all(Array.from({ length: n }, (_, i) => Sess.open(dbUrl, `s${i}`)));
}
async function healPool(pool) {
  for (let i = 0; i < pool.length; i++) {
    let ok = !pool[i].dead;
    if (ok) {
      try {
        await pool[i].q("select 1");
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      await pool[i].close();
      pool[i] = await Sess.open(dbUrl, `s${i}r`);
    } else {
      // never leave a session mid-transaction between iterations
      await pool[i].q("rollback").catch(() => {});
    }
  }
}

async function main() {
  const t0 = Date.now();
  const admin = await Sess.open(dbUrl, "admin");
  const gate = await Sess.open(dbUrl, "gate");
  const info = (await admin.q("select current_database() db, inet_server_port() port, (select count(*) from orders) orders")).rows[0];
  console.log(`connected: db=${info.db} server_port=${info.port} existing orders=${info.orders}`);
  const mig = (await admin.q("select max(version) v, count(*)::int n from supabase_migrations.schema_migrations")).rows[0];
  console.log(`migrations applied: ${mig.n} (latest ${mig.v})`);

  // Deterministic: the pg_cron workers would be a third, uncontrolled participant in every race.
  if (!keepCron) {
    const { rows } = await admin.q(
      `select jobname from cron.job where jobname in ('dispatch-tick','enqueue-rider-offer-sms','message-worker-tick') and active`,
    );
    for (const r of rows) await admin.q(`select cron.unschedule($1)`, [r.jobname]);
    if (rows.length) console.log(`unscheduled cron jobs (throwaway stack): ${rows.map((r) => r.jobname).join(", ")}`);
  }
  // other riders (seed data) must not be candidates for the fixtures
  await admin.q(`update riders set is_online = false`);

  const fx = new Fixtures(admin);
  const left = await fx.purgeLeftovers();
  if (left.n.users) console.log(`purged leftovers of an earlier run: ${JSON.stringify(left.n)}${left.problems.length ? " problems: " + left.problems.join("; ") : ""}`);
  await fx.init();
  const pool = await newPool(16);

  const results = [];
  for (const sc of allScenarios) {
    if (only && !only.includes(sc.id) && !only.includes(Math.floor(sc.id))) continue;
    const ctx = new Ctx(admin, pool, gate, fx, sc);
    const iterations = Math.max(1, Math.round(sc.iterations * scale));
    const sT = Date.now();
    let invChecks = 0;
    let invFail = 0;
    const softSeen = new Map();
    process.stdout.write(`#${sc.id} ${sc.name} (${iterations} iterations) ... `);
    if (sc.once) {
      // scenarios that batch their iterations internally (waits)
      ctx.iter = 0;
      try {
        await sc.run(ctx, 0, iterations);
      } catch (e) {
        ctx.failures.push({ iter: 0, msg: `exception: ${e.stack ?? e}` });
      }
      const inv = await checkInvariants(admin, fx.orders);
      invChecks += 1;
      if (inv.hard.length) {
        invFail++;
        ctx.failures.push({ iter: 0, msg: "INVARIANT: " + inv.hard.join(" | ") });
      }
      for (const s of inv.soft) softSeen.set(s, (softSeen.get(s) ?? 0) + 1);
      if (!noCleanup) (await fx.cleanup()).forEach((p) => ctx.failures.push({ iter: 0, msg: `cleanup: ${p}` }));
      await healPool(pool);
    } else {
      for (let i = 1; i <= iterations; i++) {
        ctx.iter = i;
        const tA = Date.now();
        try {
          await sc.run(ctx, i);
        } catch (e) {
          ctx.failures.push({ iter: i, msg: `exception: ${e.stack ?? e}` });
          await healPool(pool);
        }
        if (pool.some((s) => s.dead)) await healPool(pool);
        const tB = Date.now();
        try {
          const inv = await checkInvariants(admin, fx.orders);
          invChecks += 1;
          if (inv.hard.length) {
            invFail++;
            ctx.failures.push({ iter: i, msg: "INVARIANT: " + inv.hard.join(" | ") });
          }
          for (const s of inv.soft) softSeen.set(s, (softSeen.get(s) ?? 0) + 1);
        } catch (e) {
          ctx.failures.push({ iter: i, msg: `invariant query failed: ${e.message}` });
        }
        const tC = Date.now();
        if (!noCleanup) (await fx.cleanup()).forEach((p) => ctx.failures.push({ iter: i, msg: `cleanup: ${p}` }));
        if (process.env.TIMING) console.log(`   iter ${i}: run ${tB - tA}ms invariants ${tC - tB}ms cleanup ${Date.now() - tC}ms`);
      }
    }
    // a scenario may have changed settings: always restore
    const res = {
      id: sc.id,
      name: sc.name,
      iterations,
      ms: Date.now() - sT,
      failures: ctx.failures,
      stats: ctx.stats,
      invChecks,
      invFail,
      soft: [...softSeen.entries()].map(([k, n]) => `${k} (seen in ${n} iteration(s))`),
    };
    results.push(res);
    console.log(`${ctx.failures.length ? "FAIL" : "PASS"} (${(res.ms / 1000).toFixed(1)}s, invariants ${invChecks - invFail}/${invChecks} sets x ${INVARIANT_COUNT})`);
    for (const f of ctx.failures.slice(0, 8)) console.log(`    iter ${f.iter}: ${f.msg}${f.detail ? "  " + f.detail : ""}`);
    if (ctx.failures.length > 8) console.log(`    ... ${ctx.failures.length - 8} more`);
    for (const s of res.soft) console.log(`    SOFT: ${s}`);
  }

  const problems = noCleanup ? [] : await fx.dropBase();
  problems.forEach((p) => console.log(`base cleanup: ${p}`));

  console.log("\n==== summary ====");
  for (const r of results) {
    const st = Object.entries(r.stats)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.slice(0, 6).join(",")}${v.length > 6 ? ",.." : ""}]` : v}`)
      .join(" ");
    console.log(`#${String(r.id).padStart(2)} ${r.failures.length ? "FAIL" : "PASS"} iters=${r.iterations} inv_fail=${r.invFail} ${(r.ms / 1000).toFixed(1)}s  ${r.name}\n      ${st}`);
  }
  const total = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\ntotal: ${results.filter((r) => !r.failures.length).length}/${results.length} scenarios passed in ${total}s`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ dbUrl: dbUrl.replace(/:[^:@/]*@/, ":***@"), total_s: Number(total), results }, null, 2));
  await admin.close();
  await gate.close();
  for (const s of pool) await s.close();
  process.exit(results.some((r) => r.failures.length) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
