// Scenarios 1-3: concurrent accepts, same-rider accept storms, client timeout + retry.
import pg from "pg";
import { sleep, waitBlocked, u, msg } from "../lib/db.mjs";
import { J, val, outcome } from "../lib/jobs.mjs";
import { dispatched, early, race, count } from "./common.mjs";

const LOSER_MSG = /no active offer|already assigned or not ready/;

export default [
  {
    id: 1,
    name: "N riders accept at once (2/10/3-early): only the live-offer holder wins, losers refused",
    iterations: 60,
    async run(ctx, i) {
      const n = [2, 10, 3][i % 3];
      const status = n === 3 ? "preparing" : "ready_for_pickup";
      const d = await dispatched(ctx, { n, status });
      ctx.check(d.adv.outcome === "offered" && d.holder === d.riders[0], "engine offered to the nearest rider", d.adv);
      const useRespond = i % 2 === 1;
      const jobs = d.riders.map((uid, k) =>
        useRespond
          ? J.respond(ctx.s(k), uid, d.offer.id, "accept", `r${k}`)
          : J.accept(ctx.s(k), uid, d.order, `r${k}`),
      );
      const rs = await race(ctx, jobs, i);
      const wins = rs.map((r, k) => ({ r, k })).filter(({ r }) => (useRespond ? outcome(r) === "accepted" : r.ok));
      ctx.check(wins.length === 1 && wins[0].k === 0, "exactly one winner and it is the live-offer holder", rs.map((r) => (r.ok ? outcome(r) ?? "ok" : r.err.message)));
      for (const [k, r] of rs.entries()) {
        if (k === 0) continue;
        if (useRespond) ctx.check(outcome(r) === "not_found", `non-holder ${k} (respond with someone else's offer id) gets not_found, no leak`, val(r));
        else ctx.check(!r.ok && LOSER_MSG.test(r.err.message), `non-holder ${k} refused with a deterministic message`, r.err);
      }
      ctx.stat("wins", wins.length);
      ctx.stat("losses", rs.length - wins.length);
      const o = (await ctx.admin.q(`select rider_id, status from orders where id = $1`, [d.order])).rows[0];
      ctx.check(o.rider_id === d.holder, "orders.rider_id is the holder", o);
      ctx.check(o.status === (status === "preparing" ? "preparing" : "rider_assigned"), "status per path (early keeps status, ready -> rider_assigned)", o);
    },
  },

  {
    id: 1.1,
    name: "rider holding offers on TWO orders accepts both at once: exactly one assignment (busy)",
    iterations: 30,
    async run(ctx, i) {
      const fx = ctx.fx;
      const A = await fx.rider({ east: 1 });
      const X = await fx.rider({ east: 2 });
      const o1 = await fx.order();
      const o2 = await fx.order();
      await fx.advance(o1); // A (nearest) is asked
      const l1 = await fx.liveOffer(o1);
      ctx.check(l1?.rider_id === A, "A holds the live offer on o1", l1);
      await fx.advance(o2); // A is excluded -> X is asked
      const lx = await fx.liveOffer(o2);
      ctx.check(lx?.rider_id === X, "engine skips A (live offer elsewhere) for o2", lx);
      // force the double hold the engine refuses to create: X's offer is withdrawn and A gets a live offer too
      await ctx.admin.q(`update dispatch_offers set status = 'cancelled', close_reason = 'harness' where id = $1`, [lx.id]);
      await fx.directLiveOffer(o2, A, { cycle: lx.cycle_no, attempt: lx.attempt_no + 1 });
      await ctx.admin.q(`update order_dispatch set attempt_no = $2, state = 'offered' where order_id = $1`, [o2, lx.attempt_no + 1]);
      const rs = await race(ctx, [J.accept(ctx.s(0), A, o1, "o1"), J.accept(ctx.s(1), A, o2, "o2")], i);
      ctx.check(count(rs, (r) => r.ok) === 1, "exactly one of the two accepts succeeded", rs.map((r) => (r.ok ? "ok" : r.err.message)));
      const lose = rs.find((r) => !r.ok);
      ctx.check(lose && /already has an active order|no active offer/.test(lose.err.message), "the loser is refused as busy", lose?.err);
      const held = (await ctx.admin.q(`select count(*)::int n from orders where rider_id = $1`, [A])).rows[0].n;
      ctx.check(held === 1, "A holds exactly one order", held);
      ctx.stat("assignments", held);
    },
  },

  {
    id: 1.2,
    name: "admin assigns rider B while rider A accepts the same order: one assignment, one accepted offer",
    iterations: 40,
    async run(ctx, i) {
      const d = await dispatched(ctx, { n: 3, status: early(i) });
      const [A, B] = d.riders;
      const rs = await race(ctx, [J.accept(ctx.s(0), A, d.order, "A"), J.adminAssign(ctx.s(1), d.order, B, ctx.fx.base.admin, "admin")], i);
      const admin = rs[1];
      ctx.check(admin.ok, "admin assignment succeeded (it is allowed to replace an accepted rider)", admin.err);
      const final = (await ctx.admin.q(`select rider_id from orders where id = $1`, [d.order])).rows[0].rider_id;
      ctx.check(final === B, "the admin's choice is the final rider", { final, A, B });
      const acc = (await ctx.admin.q(`select rider_id, status from dispatch_offers where order_id = $1 order by attempt_no`, [d.order])).rows;
      ctx.check(acc.filter((x) => x.status === "accepted").length === 1, "one accepted offer", acc);
      ctx.stat(rs[0].ok ? "A_won_then_replaced" : "A_refused_before_admin");
    },
  },

  {
    id: 2,
    name: "same rider, 5 parallel accepts: one assignment, all replies succeed, side effects once",
    iterations: 40,
    async run(ctx, i) {
      const status = early(i);
      const d = await dispatched(ctx, { n: 2, status });
      const A = d.holder;
      const jobs = [0, 1, 2, 3, 4].map((k) =>
        k % 2 === 0 ? J.accept(ctx.s(k), A, d.order, `legacy${k}`) : J.respond(ctx.s(k), A, d.offer.id, "accept", `respond${k}`),
      );
      const rs = await race(ctx, jobs, i);
      ctx.check(rs.every((r) => r.ok), "every concurrent reply succeeded", rs.map((r) => (r.ok ? "ok" : r.err.message)));
      const resp = rs.filter((r) => r.label?.startsWith("respond")).map(outcome);
      ctx.check(resp.every((o) => o === "accepted" || o === "already_yours"), "respond outcomes are accepted/already_yours", resp);
      ctx.check(resp.filter((o) => o === "accepted").length <= 1, "at most one respond reported 'accepted'", resp);
      const ev = (await ctx.admin.q(
        `select (select count(*)::int from order_events where order_id = $1 and (to_status = 'rider_assigned' or (meta ->> 'early_accept') = 'true')) assigned_events,
                (select count(*)::int from dispatch_events where order_id = $1 and event = 'offer_accepted') accepted_events,
                (select count(*)::int from dispatch_offers where order_id = $1) offers,
                (select count(*)::int from dispatch_offers where order_id = $1 and status = 'accepted') accepted`,
        [d.order],
      )).rows[0];
      ctx.check(ev.assigned_events === 1, "rider_assigned/early_accept order_events written once", ev);
      ctx.check(ev.accepted_events === 1, "offer_accepted dispatch event written once", ev);
      ctx.check(ev.offers === 1 && ev.accepted === 1, "one offer row, accepted", ev);
      ctx.stat("assignments", ev.accepted);
      ctx.stat("replies_ok", rs.filter((r) => r.ok).length);
    },
  },

  {
    id: 3,
    name: "client gives up mid-call then retries (socket destroyed / query cancelled): retry is already_yours / accepted",
    iterations: 24,
    async run(ctx, i) {
      const d = await dispatched(ctx, { n: 2, status: early(i) });
      const A = d.holder;
      const destroy = i % 2 === 0; // else: cancel the in-flight query
      // a throwaway connection acting as the client that times out; autocommit single statement
      const x = new pg.Client({ connectionString: ctx.url, application_name: "kk-conc-timeout" });
      x.on("error", () => {});
      await x.connect();
      const xpid = (await x.query("select pg_backend_pid() p")).rows[0].p;
      await x.query(`set role authenticated`);
      await x.query(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: A, role: "authenticated" })}', false)`);
      // hold the order lock so the first request is genuinely in flight (blocked) when the client gives up
      await ctx.gate.q("begin");
      await ctx.gate.q(`select 1 from orders where id = ${u(d.order)} for update`);
      const first = x.query(`select to_jsonb(a) as r from accept_dispatch_offer(${u(d.order)}) a`).then(
        (r) => ({ ok: true, r }),
        (e) => ({ ok: false, e }),
      );
      const blocked = await waitBlocked(ctx.admin, xpid);
      ctx.check(blocked, "the first request is in flight (blocked on the order lock)");
      if (destroy) x.connection.stream.destroy();
      else await ctx.admin.q(`select pg_cancel_backend($1)`, [xpid]);
      await ctx.gate.q("rollback"); // release the order lock
      const firstRes = await Promise.race([first, sleep(3000).then(() => ({ timeout: true }))]);
      // let the orphaned backend finish (it commits even though nobody reads the reply)
      let committed = false;
      for (let k = 0; k < 60; k++) {
        const r = (await ctx.admin.q(`select rider_id from orders where id = $1`, [d.order])).rows[0].rider_id;
        if (r) {
          committed = true;
          break;
        }
        await sleep(50);
      }
      if (destroy) {
        ctx.check(committed, "the abandoned first request committed server-side", firstRes);
        const retry = await race(ctx, [J.respond(ctx.s(0), A, d.offer.id, "accept", "retry")], 1);
        ctx.check(outcome(retry[0]) === "already_yours", "the retry returns already_yours", val(retry[0]) ?? retry[0].err);
        const retry2 = await race(ctx, [J.accept(ctx.s(1), A, d.order, "retry-legacy")], 1);
        ctx.check(retry2[0].ok && val(retry2[0]).rider_id === A, "the legacy retry returns the order row", retry2[0].err);
      } else {
        ctx.check(!committed, "the cancelled first request left nothing behind", firstRes);
        ctx.check(!firstRes.ok && firstRes.e?.code === "57014", "client saw 'canceling statement' (57014)", firstRes.e?.message);
        const retry = await race(ctx, [J.respond(ctx.s(0), A, d.offer.id, "accept", "retry")], 1);
        ctx.check(outcome(retry[0]) === "accepted", "the retry of a cancelled request is accepted", val(retry[0]) ?? retry[0].err);
      }
      ctx.stat(destroy ? "destroyed_first_committed" : "cancelled_first_rolled_back", 1);
      await x.end().catch(() => {});
    },
  },
];
