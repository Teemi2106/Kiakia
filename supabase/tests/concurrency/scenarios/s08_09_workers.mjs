// Scenarios 8-9: two workers on many due orders (SKIP LOCKED), duplicate jobs issuing the same offer.
import { u } from "../lib/db.mjs";
import { J, val } from "../lib/jobs.mjs";
import { cluster, race, count } from "./common.mjs";

const M = 16;

async function dueOrders(ctx, m) {
  const rows = [];
  for (let k = 0; k < m; k++) {
    const c = await cluster(ctx, k % 30, { n: 3, status: k % 2 ? "preparing" : "ready_for_pickup" });
    const lapsed = await ctx.fx.lapsedOffer(c.order, c.riders[0], { attempt: 1 });
    rows.push({ ...c, lapsed });
  }
  return rows;
}

/** Autocommit `call dispatch_tick()` (a procedure that COMMITs per order cannot sit inside begin/commit). */
async function callTick(sess) {
  const t0 = Date.now();
  try {
    await sess.q("call dispatch_tick()");
    return { ok: true, label: "call", ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, label: "call", err: { message: e.message, code: e.code }, ms: Date.now() - t0 };
  }
}

export default [
  {
    id: 8,
    name: "two/three dispatch workers on 16 due orders at once (dispatch_tick, _dispatch_tick_run, sweep): one offer per order, totals match",
    iterations: 12,
    async run(ctx, i) {
      const rows = await dueOrders(ctx, M);
      const variant = i % 4;
      const holdSome = i % 3 === 0; // another session holds 4 order locks: workers must skip them, not wait
      const held = holdSome ? rows.slice(0, 4) : [];
      const holder = ctx.s(15);
      if (holdSome) {
        await holder.q("begin");
        await holder.q(`select 1 from orders where id = any($1::uuid[]) for update`, [held.map((r) => r.order)]);
      }
      let results;
      if (variant === 0) {
        results = await Promise.all([callTick(ctx.s(0)), callTick(ctx.s(1))]);
      } else if (variant === 1) {
        results = await race(ctx, [J.tickRun(ctx.s(0), "w1"), J.tickRun(ctx.s(1), "w2")], i);
      } else if (variant === 2) {
        results = await race(ctx, [J.sweep(ctx.s(0), "w1"), J.sweep(ctx.s(1), "w2")], i);
      } else {
        const [a, b] = await Promise.all([callTick(ctx.s(0)), race(ctx, [J.tickRun(ctx.s(1), "w2"), J.sweep(ctx.s(2), "w3")], i)]);
        results = [a, ...b];
      }
      for (const r of results) ctx.check(r.ok, `${r.label} did not error (a held order is skipped, never waited for)`, r.err);
      if (holdSome) {
        for (const r of held) {
          const live = await ctx.fx.liveOffer(r.order);
          ctx.check(live && live.rider_id === r.riders[0] && live.attempt_no === 1, "a locked order was skipped by every worker (still the lapsed attempt 1)", live);
        }
        await holder.q("rollback");
        ctx.stat("locked_orders_skipped", held.length);
        await race(ctx, [J.tickRun(ctx.s(3), "after-release")], 1);
      }
      // 0109: sweep_dispatch_offers() now claims at most 10 orders per call (it holds every order lock in one
      // transaction), so two sweeps cannot finish 16 orders between them. Drain what is left with further
      // sweeps and judge 'one offer per order' on the finished run; their totals count towards the sum below.
      const drains = [];
      if (variant === 2 || variant === 3) {
        for (let k = 0; k < 4; k++) {
          const d = await race(ctx, [J.sweep(ctx.s(3), "drain" + k)], 1);
          for (const x of d) ctx.check(x.ok, 'drain sweep did not error', x.err);
          drains.push(...d.filter((x) => x.ok && x.rows?.[0]?.r).map((x) => val(x)));
        }
      }
      const fx = ctx.fx;
      let ok = 0;
      for (const r of rows) {
        const offers = await fx.offers(r.order);
        const live = offers.filter((o) => o.status === "offered");
        const good =
          offers.length === 2 &&
          offers[0].status === "expired" &&
          live.length === 1 &&
          live[0].attempt_no === 2 &&
          live[0].rider_id === r.riders[1];
        if (good) ok++;
        else ctx.check(false, "order has exactly one new live offer (attempt 2 to the next rider)", offers.map((o) => [o.attempt_no, o.status]));
        const ev = (await ctx.admin.q(`select count(*)::int n from dispatch_events where order_id = $1 and event = 'offer_created'`, [r.order])).rows[0].n;
        ctx.check(ev === 1, "exactly one offer_created event", ev);
      }
      ctx.stat("orders_with_exactly_one_new_offer", ok);
      ctx.stat("orders_total", rows.length);
      // totals reported by the workers that report them
      const created = results.filter((r) => r.ok && r.rows?.[0]?.r).map((r) => val(r));
      if (created.length && !holdSome) {
        const sumCreated = [...created, ...drains].reduce((n, c) => n + Number(c.offers_created ?? 0), 0);
        const sumExpired = [...created, ...drains].reduce((n, c) => n + Number(c.offers_expired ?? 0), 0);
        // when a `call dispatch_tick()` ran alongside, it also took a share that the others cannot see
        const onlyReporters = variant !== 0 && variant !== 3;
        if (onlyReporters) {
          ctx.check(sumCreated === rows.length, "sum of offers_created reported by the workers equals the due orders", { sumCreated, rows: rows.length });
          ctx.check(sumExpired === rows.length, "sum of offers_expired equals the due orders", { sumExpired });
        }
        const processed = created.map((c) => Number(c.processed ?? c.offers_created ?? 0));
        ctx.note('reported', created.map((c) => Number(c.offers_created)).join('+'));
        if (processed.length >= 2 && processed.every((n) => n > 0)) ctx.stat("both_workers_got_work");
        ctx.note("split", processed.join("/"));
      }
    },
  },

  {
    id: 8.1,
    name: "two workers advance TWO orders that share one nearest rider (0107 rider lock): the rider must not get two live offers",
    iterations: 40,
    async run(ctx, i) {
      const fx = ctx.fx;
      const [A, B, C] = await fx.riders([{ east: 1 }, { east: 3 }, { east: 4 }]);
      const o1 = await fx.order();
      const o2 = await fx.order();
      // both orders are due and A is the nearest eligible rider for both
      const rs = await race(ctx, [J.tickOrder(ctx.s(0), o1, "worker1-o1"), J.tickOrder(ctx.s(1), o2, "worker2-o2")], i);
      for (const r of rs) ctx.check(r.ok, `${r.label} did not error`, r.err);
      const live = (await ctx.admin.q(`select order_id, rider_id from dispatch_offers where order_id = any($1::uuid[]) and status = 'offered'`, [[o1, o2]])).rows;
      ctx.check(live.length === 2, "both orders hold a live offer", live);
      const dup = live.length === 2 && live[0].rider_id === live[1].rider_id;
      ctx.check(!dup, "0107: the shared nearest rider is NOT offered both orders", live);
      ctx.stat(dup ? "same_rider_two_live_offers" : "distinct_riders");
      // whatever happened, the hard guarantee must hold: the rider can only take ONE of them
      if (dup) {
        const rid = live[0].rider_id;
        const acc = await race(ctx, [J.accept(ctx.s(2), rid, o1, "accept-o1"), J.accept(ctx.s(3), rid, o2, "accept-o2")], i);
        ctx.check(count(acc, (r) => r.ok) === 1, "the doubly-offered rider can accept only one order", acc.map((r) => (r.ok ? "ok" : r.err.message)));
      }
    },
  },

  {
    id: 9,
    name: "duplicate queue jobs issue the same offer (8 concurrent tick/advance/sweep on one order): exactly one offer",
    iterations: 50,
    async run(ctx, i) {
      const fresh = i % 2 === 0; // fresh = no offer yet (first offer); else a lapsed attempt 1
      const c = await cluster(ctx, i % 30, { n: 3 });
      if (!fresh) await ctx.fx.lapsedOffer(c.order, c.riders[0], { attempt: 1 });
      const jobs = [
        J.tickOrder(ctx.s(0), c.order, "tick1"),
        J.tickOrder(ctx.s(1), c.order, "tick2"),
        J.tickOrder(ctx.s(2), c.order, "tick3"),
        J.advance(ctx.s(3), c.order, "adv1"),
        J.advance(ctx.s(4), c.order, "adv2"),
        J.advance(ctx.s(5), c.order, "adv3"),
        J.sweep(ctx.s(6)),
        J.tickRun(ctx.s(7)),
      ];
      const rs = await race(ctx, jobs, i);
      for (const r of rs) ctx.check(r.ok, `${r.label} returned (no error escapes the engine)`, r.err);
      const offers = await ctx.fx.offers(c.order);
      const want = fresh ? 1 : 2;
      ctx.check(offers.length === want, `exactly ${want} offer row(s) in total`, offers.map((o) => [o.attempt_no, o.cycle_no, o.status]));
      ctx.check(offers.filter((o) => o.status === "offered").length === 1, "exactly one live offer", offers.map((o) => o.status));
      const ev = (await ctx.admin.q(`select count(*)::int n from dispatch_events where order_id = $1 and event = 'offer_created'`, [c.order])).rows[0].n;
      ctx.check(ev === 1, "exactly one offer_created event", ev);
      const pushes = (await ctx.admin.q(`select count(*)::int n from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':push' where d.order_id = $1`, [c.order])).rows[0].n;
      ctx.check(pushes === offers.length, "one push row per offer (no duplicate)", { pushes, offers: offers.length });
      const dupes = rs.filter((r) => r.ok && (val(r)?.reason === "concurrent_offer" || val(r)?.outcome === "waiting")).length;
      ctx.stat("jobs_that_saw_the_live_offer", dupes);
      ctx.stat("offers_made", offers.length);
    },
  },

  {
    id: 9.1,
    name: "DB backstop: concurrent identical / second-live inserts of dispatch_offers hit the unique indexes",
    iterations: 20,
    async run(ctx, i) {
      const fx = ctx.fx;
      const riders = await fx.riders(Array.from({ length: 8 }, (_, k) => ({ east: k + 1 })));
      const order = await fx.order();
      // (a) the same (order, cycle, attempt) by 8 sessions -> one row (duplicate worker issuing the same offer)
      // (b) distinct cycles (so the triple differs) but all 'offered' -> the one-live index still lets one in
      const same = i % 2 === 0;
      if (!same) await fx.lapsedOffer(order, riders[0], { cycle: 1, attempt: 1, status: "expired" });
      const jobs = riders.map((r, k) =>
        J.rawSql(
          ctx.s(k),
          `insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, expires_at)
           values (${u(order)}, ${u(r)}, 'offered', ${same ? 1 : k + 2}, ${same ? 1 : 2}, now() + interval '45 seconds') returning id as r`,
          `ins${k}`,
        ),
      );
      const rs = await race(ctx, jobs, i);
      const okN = rs.filter((r) => r.ok).length;
      ctx.check(okN === 1, `exactly one insert won (${same ? "same attempt" : "distinct cycles"})`, rs.map((r) => (r.ok ? "ok" : r.err.code)));
      ctx.check(rs.filter((r) => !r.ok).every((r) => r.err.code === "23505"), "every loser failed with unique_violation 23505", rs.filter((r) => !r.ok).map((r) => r.err.code));
      ctx.stat("unique_violations", rs.length - okN);
    },
  },
];
