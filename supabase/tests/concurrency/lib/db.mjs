// Session + barrier primitives. Every "session" is a separate pg connection, i.e. a
// separate Postgres backend, which is what makes the races real.
import pg from "pg";

const { Client } = pg;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quote a uuid for inlining into a multi-statement simple query. Throws on anything else. */
export function u(id) {
  if (id === null || id === undefined) return "null";
  if (!UUID_RE.test(String(id))) throw new Error(`not a uuid: ${id}`);
  return `'${id}'::uuid`;
}

export class Sess {
  constructor(client, label, pid) {
    this.client = client;
    this.label = label;
    this.pid = pid;
    this.dead = false;
  }

  static async open(url, label) {
    const client = new Client({ connectionString: url, application_name: `kk-conc-${label}` });
    client.on("error", () => {}); // a terminated backend must not crash the runner
    await client.connect();
    const { rows } = await client.query("select pg_backend_pid() as pid");
    return new Sess(client, label, rows[0].pid);
  }

  q(sql, params) {
    return this.client.query(sql, params);
  }

  async rollbackQuiet() {
    try {
      await this.client.query("rollback");
    } catch {
      this.dead = true;
    }
  }

  async close() {
    try {
      await this.client.end();
    } catch {
      /* already gone */
    }
  }
}

/** PostgREST-style impersonation preludes (inside a transaction, `set local`). */
export function riderPrelude(uid) {
  return `set local role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: "authenticated" })}', true);`;
}
export function servicePrelude() {
  return `set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true);`;
}

let gateSeq = 1_000_000 + Math.floor(Math.random() * 1_000_000);

function errInfo(e) {
  return { code: e.code ?? null, message: String(e.message ?? e), severity: e.severity ?? null };
}

/**
 * One job = { sess, as: 'rider'|'service'|'postgres', uid?, sql } where `sql` is ONE statement
 * (the call). It runs in its own transaction, exactly like a PostgREST request:
 *   begin; set local role ..; set_config(claims); [barrier]; <sql>; commit
 * Returns { ok, rows, err, ms }.
 */
async function runJob(job, barrierKey) {
  const s = job.sess;
  const t0 = Date.now();
  try {
    let prelude = "";
    if (job.as === "rider") prelude = riderPrelude(job.uid);
    else if (job.as === "service") prelude = servicePrelude();
    await s.q(`begin; ${prelude}`);
    const gate = (barrierKey ? `select pg_advisory_xact_lock_shared(${barrierKey});` : "") + (job.jitterMs ? ` select pg_sleep(${(Math.random() * job.jitterMs / 1000).toFixed(4)});` : "");
    const res = await s.q(`${gate} ${job.sql}; commit;`);
    const arr = Array.isArray(res) ? res : [res];
    // the call is the second-to-last result (the last is `commit`); gate/sleep results come before it
    const callRes = arr[arr.length - 2];
    return { ok: true, rows: callRes?.rows ?? [], ms: Date.now() - t0, label: job.label };
  } catch (e) {
    await s.rollbackQuiet();
    return { ok: false, err: errInfo(e), ms: Date.now() - t0, label: job.label };
  }
}

/**
 * Run all jobs at the same instant. With `barrier` a gate session holds an exclusive advisory lock, every
 * job queues on the shared form of it (we verify in pg_stat_activity that they are ALL parked), then the
 * gate commits and they proceed together.
 */
export async function runConcurrent(gate, jobs, { barrier = true, jitterMs = 0 } = {}) {
  if (jitterMs) for (const j of jobs) j.jitterMs = jitterMs;
  if (!barrier) return Promise.all(jobs.map((j) => runJob(j, null)));
  const key = gateSeq++;
  await gate.q("begin");
  await gate.q(`select pg_advisory_xact_lock(${key})`);
  const started = jobs.map((j) => runJob(j, key));
  const pids = jobs.map((j) => j.sess.pid);
  const t0 = Date.now();
  for (;;) {
    const { rows } = await gate.q(
      `select count(*)::int n from pg_stat_activity where pid = any($1::int[]) and wait_event_type = 'Lock' and wait_event = 'advisory'`,
      [pids],
    );
    if (rows[0].n >= pids.length) break;
    if (Date.now() - t0 > 4000) break; // a job that failed before the barrier; release anyway
    await sleep(5);
  }
  await gate.q("commit");
  return Promise.all(started);
}

/** Wait until `pid` is blocked on a lock (any), or time out. */
export async function waitBlocked(obs, pid, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { rows } = await obs.q(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (rows[0]?.wait_event_type === "Lock") return true;
    await sleep(5);
  }
  return false;
}

/** Message of a job result for pattern checks. */
export function msg(r) {
  return r.ok ? null : r.err.message;
}
