# Dispatch concurrency harness

Multi-session race tests for the sequential dispatch (migrations 0099-0106, `docs/dispatch-design.md`).
pgTAP runs in one transaction, so it cannot prove anything about two backends at once. This harness opens
real, separate Postgres connections against a database with **committed** fixtures and checks the
database invariants after every iteration.

Dev-only tooling, like `supabase/tests/h3/`: its own `package.json`, not a pnpm workspace member, never a
runtime dependency. It uses `pg` only.

## Where it may run

**Only on the isolated e2e stack** (project `kiakia-e2ecycle`, db port `58322`). It commits rows and, at start,
unschedules the pg_cron jobs of that throwaway database (`dispatch-tick`, `enqueue-rider-offer-sms`,
`message-worker-tick`) so the scenarios are the only participants in a race. The runner refuses ports
54321-54324 / 5432 and any non-local host, and refuses any port other than `E2E_PORT_BASE + 2`.
Never point it at admintest (54322) or a hosted project: tests there must stay in rolled-back transactions.

## Run

```bash
pnpm --filter web e2e:cycle:up                 # fresh stack: replays ALL migrations 0001..latest + seed
cd supabase/tests/concurrency
pnpm install --ignore-workspace                # once; installs pg
node run.mjs --db-url postgresql://postgres:postgres@127.0.0.1:58322/postgres
pnpm --filter web e2e:cycle:down               # ALWAYS tear down (deletes the stack's volumes)
```

Options: `--only 1,9,15` (a number selects its sub-scenarios too: `1` runs 1, 1.1, 1.2), `--scale 0.25` (fewer
iterations, for a smoke run), `--json out.json`, `--keep-cron`, `--no-cleanup`, `--db-url` (or `E2E_DB_URL`).
`TIMING=1` prints per-iteration phase times. Exit code 0 only if every scenario passed.

### CI and the manual requirement

`.github/workflows/ci.yml` has a `concurrency` job that brings up the same isolated stack on a GitHub runner and runs
`node run.mjs --scale 0.25` (about a quarter of the iterations: a smoke run that still exercises every scenario and every
invariant). It is NOT a replacement for the full run: before releasing a change to anything under dispatch (migrations 0099+,
`_dispatch_*`, accept/decline RPCs, the tick) run the full scale locally (no `--scale`) and record the result in
`docs/dispatch-design.md`. The CI job has not been observed on a hosted runner yet (it needs Docker-in-runner, a second Supabase
stack and the Edge Runtime for the monnify-webhook function that `e2e:cycle:up` also serves); if it proves flaky there, move it to
a manually-triggered workflow and keep this manual requirement.

On Windows, `stack.mjs` skips `node_modules` when it copies `supabase/` (pnpm symlinks cannot be copied
without privileges), which is what lets `e2e:cycle:up` work with this folder installed.

## How a race is made real

* Every session is a separate connection (a separate backend). Riders are impersonated the way PostgREST does:
  `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<uid>","role":"authenticated"}', true); <call>; commit`.
  Workers run as `postgres` (what pg_cron is) or `service_role`.
* **Barrier:** a gate session holds an exclusive advisory lock; every racing job queues on the shared form of the
  same lock *inside its own transaction*; the runner checks in `pg_stat_activity` that all of them are parked, then
  the gate commits and they run together. Every 4th iteration fires with no barrier, and a random `pg_sleep` jitter
  (0 / up to 8 ms / up to 25 ms) is applied per job so that different interleavings are exercised.
* Deterministic interleavings (a session holding a row lock while another queues behind it) are used where the
  claim is about order, e.g. "offline commits, then the accept runs".
* Connection killing: `pg_terminate_backend` for crashes, `pg_cancel_backend` and a destroyed socket for client timeouts.

## Invariants checked after EVERY iteration (`lib/invariants.mjs`)

At most one live offer per order; at most one accepted offer per order; `orders.rider_id` equals the accepted
offer's rider (or both null); no accepted offer answered after its expiry; no rider holds two active orders;
attempt numbers unique, contiguous 1..n, cycle never going backwards; `order_dispatch` attempt/cycle/state consistent
with `orders` and the offers; no live offer on an assigned or closed order; status and rider agree; at most one rider-driven
`rider_assigned` order event; at most one early-accept event; one `offer_accepted` event per accepted offer; no closed
offer with a still-queued push; every live offer has exactly one push row; no rider holds more than one live unexpired offer (hard since 0107). Any future
"soft" rule is reported separately and never hidden by a pass.

## Scenarios

| # | What |
|---|------|
| 1 | 2 / 10 / 3-early riders accept at once: only the live-offer holder wins |
| 1.1 | a rider holding offers on two orders accepts both at once: exactly one assignment |
| 1.2 | admin assigns B while A accepts the same order |
| 2 | same rider, 5 parallel accepts (legacy + respond): one assignment, side effects once |
| 3 | client gives up mid-call (socket destroyed / query cancelled), then retries |
| 4, 4.1 | accept after expiry (inserted lapsed; and a real 15 s timeout waited out) |
| 5 | accept after another rider was assigned / stale holders |
| 6 | tick / sweep / tick_run racing the accept: assignment survives, no new offer |
| 7 | stale timeout job after a newer offer: attempt N+1 untouched |
| 8 | 2-3 workers (`call dispatch_tick()`, `_dispatch_tick_run`, `sweep_dispatch_offers`) on 16 due orders, with some orders locked by a third session |
| 9, 9.1 | duplicate queue jobs issuing the same offer; DB backstop (unique indexes) |
| 10 | rider goes offline / is assigned elsewhere while the offer is pending |
| 11 | platform cancel racing the accept |
| 12 | decline (x3) racing ticks |
| 13 | everyone declines / times out: cycles, never re-asking declined riders, needs_attention |
| 14 | ring expansion and a rider just across an H3 cell boundary (ring asserted against an independent SQL computation) |
| 15 | crash safety: killed session leaves no offer / outbox row; committed offer + push; claim path; killed accept |
| 16 | dedupe_key under concurrent enqueues, late push suppressed, `get_dispatch_offer` authoritative, withdrawn push once |

## Notes

* Fixtures use unique ids/emails (`conc-<run>-...`) and are deleted after each iteration; `dispatch_events` is
  append-only (guard trigger) and keeps its rows. A crashed earlier run is purged at start. The admin user stays once an
  admin action wrote `admin_audit_log` (append-only); the whole database is wiped by `e2e:cycle:down` anyway.
* No external call is made: the Vault has no `message_worker_*` secrets on the e2e stack, so `invoke_message_worker()`
  only raises a NOTICE and `pg_net` is never reached; `message_claim_batch` is exercised inside rolled-back transactions
  (nothing is sent).
* Scenario 4.1 temporarily sets `dispatch_offer_timeout_seconds` to 15 and restores it in `finally`.
