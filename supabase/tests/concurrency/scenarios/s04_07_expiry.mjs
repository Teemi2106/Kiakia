// Scenarios 4-7: accept after expiry, accept after another rider won, tick vs accept, stale worker.
import { sleep } from "../lib/db.mjs";
import { J, val, outcome } from "../lib/jobs.mjs";
import { dispatched, early, race, count, cluster } from "./common.mjs";

export default [
  {
    id: 4,
    name: "accept after expiry (offer inserted already lapsed) racing ticks and the next rider: expired offer never wins",
    iterations: 40,
    async run(ctx, i) {
      const fx = ctx.fx;
      const [r1, r2, r3] = await fx.riders([{ east: 1 }, { east: 2 }, { east: 3 }]);
      const order = await fx.order({ status: early(i) });
      const lapsed = await fx.lapsedOffer(order, r1);
      const rs = await race(
        ctx,
        [
          J.respond(ctx.s(0), r1, lapsed, "accept", "r1-respond"),
          J.accept(ctx.s(1), r1, order, "r1-legacy"),
          J.tickOrder(ctx.s(2), order, "tick-a"),
          J.tickOrder(ctx.s(3), order, "tick-b"),
          J.accept(ctx.s(4), r2, order, "r2-legacy"),
        ],
        i,
      );
      const byLabel = Object.fromEntries(rs.map((r) => [r.label, r]));
      const o1 = outcome(byLabel["r1-respond"]);
      // 'expired' normally; 'taken/assigned_to_other' when the next rider (r2) already took the order (checked against the final state below)
      ctx.check(o1 === "expired" || (o1 === "taken" && val(byLabel["r1-respond"]).reason === "assigned_to_other"), "the lapsed holder's accept is refused ('expired', or 'taken' once r2 won)", val(byLabel["r1-respond"]) ?? byLabel["r1-respond"].err);
      // 'offer has expired' normally; 'order already assigned' when the next rider (r2) took the order in the meantime
      ctx.check(!byLabel["r1-legacy"].ok && /offer has expired|no active offer|already assigned or not ready/.test(byLabel["r1-legacy"].err.message), "legacy accept after expiry is refused (offer has expired / order already assigned)", byLabel["r1-legacy"].err);
      await fx.makeDue(order);
      await race(ctx, [J.tickOrder(ctx.s(5), order, "settle")], 1);
      const st = (await ctx.admin.q(`select rider_id from orders where id = $1`, [order])).rows[0];
      const offers = await fx.offers(order);
      ctx.check(offers[0].rider_id === r1 && offers[0].status === "expired", "r1's offer is closed expired", offers[0]);
      ctx.check(st.rider_id !== r1, "the expired rider was never assigned", st);
      const live = offers.filter((o) => o.status === "offered");
      if (st.rider_id) {
        ctx.check(st.rider_id === r2, "only the next rider (who held a live offer by then) can have won", st);
        ctx.stat("next_rider_won", 1);
      } else {
        ctx.check(live.length === 1 && live[0].rider_id === r2, "the order advanced to the next rider (one live offer)", offers.map((o) => [o.rider_id === r2 ? "r2" : o.rider_id === r3 ? "r3" : "r1", o.status]));
        ctx.stat("advanced_to_next", 1);
      }
      if (o1 === "taken") ctx.check(st.rider_id === r2, "'taken' is only possible because r2 holds the order", st);
      ctx.stat(o1 === "expired" ? "answered_expired" : "answered_taken_after_r2_won");
    },
  },

  {
    id: 4.1,
    name: "accept after a REAL timeout (offer ttl set to 15 s, waited out): refused, order advanced",
    iterations: 6, // orders run in parallel while ONE 16 s wait is shared
    once: true,
    async run(ctx, _i, n) {
      const fx = ctx.fx;
      const old = await fx.setSetting("dispatch_offer_timeout_seconds", 15);
      try {
        const set = [];
        for (let k = 0; k < n; k++) {
          const { riders: [r1, r2], order } = await cluster(ctx, k, { n: 2, status: early(k) });
          await fx.advance(order);
          const offer = await fx.liveOffer(order);
          ctx.check(offer.rider_id === r1 && Math.round((new Date(offer.expires_at) - new Date(offer.offered_at)) / 1000) === 15, "offer carries the 15 s ttl", offer);
          set.push({ order, r1, r2, offer });
        }
        await sleep(16500);
        for (const [k, s] of set.entries()) {
          // pings stay fresh (ttl wait must not make riders stale: location max age is 300 s)
          const rs = await race(
            ctx,
            [J.respond(ctx.s(0), s.r1, s.offer.id, "accept", "late-accept"), J.tickOrder(ctx.s(1), s.order, "tick")],
            k,
          );
          ctx.check(outcome(rs[0]) === "expired", `late accept #${k} answered expired`, val(rs[0]) ?? rs[0].err);
          const rider = (await ctx.admin.q(`select rider_id from orders where id = $1`, [s.order])).rows[0].rider_id;
          ctx.check(rider === null, `nobody assigned on order #${k}`, rider);
          const live = await fx.liveOffer(s.order);
          ctx.check(live && live.rider_id === s.r2, `order #${k} advanced to the next rider`, live);
          ctx.stat("refused_after_timeout");
        }
      } finally {
        await fx.setSetting("dispatch_offer_timeout_seconds", old);
      }
    },
  },

  {
    id: 5,
    name: "accept after another rider was assigned: refused, winner unchanged",
    iterations: 40,
    async run(ctx, i) {
      const fx = ctx.fx;
      const [r1, r2, r3] = await fx.riders([{ east: 1 }, { east: 2 }, { east: 3 }]);
      const order = await fx.order({ status: early(i) });
      const stale = await fx.lapsedOffer(order, r2, { attempt: 1 }); // r2 was asked first and let it lapse
      await fx.advance(order); // closes it (expired) and asks r1
      const live = await fx.liveOffer(order);
      ctx.check(live?.rider_id === r1 && live.attempt_no === 2, "r1 is the live holder after r2's lapse", live);
      const rs = await race(
        ctx,
        [
          J.accept(ctx.s(0), r1, order, "winner"),
          J.respond(ctx.s(1), r2, stale, "accept", "stale-r2"),
          J.accept(ctx.s(2), r2, order, "stale-r2-legacy"),
          J.accept(ctx.s(3), r3, order, "never-asked-r3"),
          J.respond(ctx.s(4), r1, live.id, "decline", "winner-declines"),
        ],
        i,
      );
      const b = Object.fromEntries(rs.map((r) => [r.label, r]));
      const winnerFirst = b.winner.ok;
      const declineFirst = outcome(b["winner-declines"]) === "declined";
      // r1 accepting and r1 declining race each other (the same rider): one of them decides; never both
      ctx.check(!(winnerFirst && declineFirst), "a rider's accept and decline of one offer cannot both take effect", [b.winner.ok, val(b["winner-declines"])]);
      ctx.check(!["accepted"].includes(outcome(b["stale-r2"])), "stale r2 did not win", val(b["stale-r2"]));
      ctx.check(["expired", "taken", "withdrawn"].includes(outcome(b["stale-r2"])), "stale r2 gets a deterministic refusal", val(b["stale-r2"]) ?? b["stale-r2"].err);
      ctx.check(!b["stale-r2-legacy"].ok, "r2 legacy accept refused (r2 was already asked in this cycle)", b["stale-r2-legacy"].err);
      // r3 was never asked, so it can only succeed if r1's decline already handed it the next live offer
      if (b["never-asked-r3"].ok) {
        ctx.check(outcome(b["winner-declines"]) === "declined" && !b.winner.ok, "r3 won only because r1 declined first (r3 was the next rider)", [val(b["winner-declines"]), b.winner.ok]);
        ctx.stat("r3_next_rider_won_after_decline");
      }
      const rider = (await ctx.admin.q(`select rider_id from orders where id = $1`, [order])).rows[0].rider_id;
      if (winnerFirst) {
        ctx.check(rider === r1, "winner unchanged: r1", rider);
        // the losers retry after the fact: still refused, winner still r1
        const again = await race(ctx, [J.respond(ctx.s(1), r2, stale, "accept", "r2-again"), J.accept(ctx.s(2), r3, order, "r3-again")], 1);
        ctx.check(outcome(again[0]) === "taken" && !again[1].ok, "retries after the win are refused ('taken')", [val(again[0]), again[1].err]);
        const rider2 = (await ctx.admin.q(`select rider_id from orders where id = $1`, [order])).rows[0].rider_id;
        ctx.check(rider2 === r1, "winner still r1 after the retries", rider2);
        ctx.stat("r1_won");
      } else {
        ctx.check(rider === null || rider === r3, "r1 declined first: order moves on (only the next rider r3 may hold it)", rider);
        ctx.stat("r1_declined_first");
      }
    },
  },

  {
    id: 6,
    name: "timeout processing (tick / sweep / tick_run) racing the accept: assignment survives, no new offer",
    iterations: 60,
    async run(ctx, i) {
      const d = await dispatched(ctx, { n: 3, status: early(i) });
      await ctx.fx.makeDue(d.order); // the tick considers this order due while the offer is still live and unexpired
      const accept = i % 2 ? J.accept(ctx.s(0), d.holder, d.order, "accept") : J.respond(ctx.s(0), d.holder, d.offer.id, "accept", "accept");
      const rs = await race(
        ctx,
        [accept, J.tickOrder(ctx.s(1), d.order, "tick1"), J.tickOrder(ctx.s(2), d.order, "tick2"), J.sweep(ctx.s(3)), J.tickRun(ctx.s(4))],
        i,
      );
      ctx.check(rs[0].ok && (i % 2 ? true : ["accepted", "already_yours"].includes(outcome(rs[0]))), "the accept won against the timeout workers", rs[0].err ?? val(rs[0]));
      for (const r of rs.slice(1)) ctx.check(r.ok, `${r.label} did not error`, r.err);
      const offers = await ctx.fx.offers(d.order);
      ctx.check(offers.length === 1 && offers[0].status === "accepted", "no new offer was made; the accepted offer is the only row", offers.map((o) => [o.attempt_no, o.status]));
      const o = (await ctx.admin.q(`select rider_id from orders where id = $1`, [d.order])).rows[0];
      ctx.check(o.rider_id === d.holder, "assignment survived", o);
      ctx.stat("assignments_survived");
    },
  },

  {
    id: 7,
    name: "stale timeout job after a newer offer: the newer offer (attempt N+1) is untouched",
    iterations: 40,
    async run(ctx, i) {
      const fx = ctx.fx;
      const [r1, r2, r3] = await fx.riders([{ east: 1 }, { east: 2 }, { east: 3 }]);
      const order = await fx.order({ status: early(i) });
      const old = await fx.lapsedOffer(order, r1, { attempt: 1 });
      const first = await race(ctx, [J.tickOrder(ctx.s(0), order, "real-timeout-job")], 1); // attempt 1 times out, attempt 2 -> r2
      ctx.check(first[0].ok, "the real timeout job ran", first[0].err);
      const B = await fx.liveOffer(order);
      ctx.check(B?.rider_id === r2 && B.attempt_no === 2, "attempt 2 is live for r2", B);
      // delayed duplicates of the job that handled attempt 1, plus the old holder still trying
      const rs = await race(
        ctx,
        [
          J.tickOrder(ctx.s(1), order, "old-job-1"),
          J.tickOrder(ctx.s(2), order, "old-job-2"),
          J.advance(ctx.s(3), order, "old-advance"),
          J.sweep(ctx.s(4)),
          J.tickRun(ctx.s(5)),
          J.respond(ctx.s(6), r1, old, "accept", "old-holder-accept"),
          J.respond(ctx.s(7), r1, old, "decline", "old-holder-decline"),
        ],
        i,
      );
      for (const r of rs) ctx.check(r.ok, `${r.label} did not error`, r.err);
      ctx.check(outcome(rs[5]) === "expired", "the old holder's late accept is 'expired'", val(rs[5]));
      ctx.check(["expired"].includes(outcome(rs[6])), "the old holder's late decline is 'expired' (no effect on the newer offer)", val(rs[6]));
      const after = (await fx.offers(order));
      const B2 = after.find((o) => o.id === B.id);
      ctx.check(B2.status === "offered" && B2.expires_at.getTime() === B.expires_at.getTime() && B2.attempt_no === 2, "attempt 2 untouched (same id, still live, same expiry)", { before: B.expires_at, after: B2 });
      ctx.check(after.length === 2, "no extra offers were created by the stale jobs", after.map((o) => [o.attempt_no, o.status]));
      ctx.stat("newer_offer_intact");
    },
  },
];
