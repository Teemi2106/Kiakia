// Scenarios 10-12: rider goes unavailable mid-offer, order cancelled mid-dispatch, decline vs tick.
import { u, waitBlocked, riderPrelude } from "../lib/db.mjs";
import { J, val, outcome } from "../lib/jobs.mjs";
import { dispatched, early, race, count, cluster } from "./common.mjs";

export default [
  {
    id: 10,
    name: "rider becomes unavailable (offline / busy elsewhere) while the offer is pending, racing their accept",
    iterations: 48,
    async run(ctx, i) {
      const fx = ctx.fx;
      const v = i % 4;
      if (v === 0 || v === 3) {
        // Deterministic interleaving: the offline transaction holds the rider row, the accept queues behind it,
        // the offline commits, THEN the accept runs: it must see the committed offline state.
        const d = await dispatched(ctx, { n: 3, status: early(i) });
        const A = d.holder;
        const X = ctx.s(0);
        const Y = ctx.s(1);
        await X.q(`begin; ${riderPrelude(A)}`);
        await X.q(`select to_jsonb(r) from set_rider_online(false) r`); // row lock on riders(A), uncommitted
        await Y.q(`begin; ${riderPrelude(A)}`);
        const call = v === 0
          ? `select respond_to_dispatch_offer(${u(d.offer.id)}, 'accept') as r; commit;`
          : `select to_jsonb(a) as r from accept_dispatch_offer(${u(d.order)}) a; commit;`;
        const pending = Y.q(call).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
        const blocked = await waitBlocked(ctx.admin, Y.pid);
        ctx.check(blocked, "the accept is queued behind the offline transaction");
        await X.q("commit");
        const res = await pending;
        if (!res.ok) await Y.rollbackQuiet();
        if (v === 0) {
          const o = res.ok ? res.r[0].rows[0].r : null;
          ctx.check(o?.outcome === "ineligible" && o.reason === "location", "accept after the offline commit is 'ineligible/location'", o ?? res.e?.message);
        } else {
          ctx.check(!res.ok && /must be online with a location update/.test(res.e.message), "legacy accept after the offline commit raises 'must be online'", res.e?.message);
        }
        const rider = (await ctx.admin.q(`select rider_id from orders where id = $1`, [d.order])).rows[0].rider_id;
        ctx.check(rider === null, "no assignment to the offline rider", rider);
        // the next engine look cancels the dead offer and asks the next rider
        await fx.makeDue(d.order);
        await race(ctx, [J.tickOrder(ctx.s(2), d.order)], 1);
        const offers = await fx.offers(d.order);
        ctx.check(offers[0].status === "cancelled" && offers[0].close_reason === "rider_unavailable", "offer to the offline rider cancelled (rider_unavailable)", offers[0]);
        const live = offers.find((o) => o.status === "offered");
        ctx.check(live && live.rider_id === d.riders[1], "the next rider holds the live offer", offers.map((o) => [o.attempt_no, o.status]));
        ctx.stat("offline_first_refused");
      } else if (v === 1) {
        // free race: offline vs accept, same rider
        const d = await dispatched(ctx, { n: 3, status: early(i) });
        const A = d.holder;
        const rs = await race(ctx, [J.respond(ctx.s(0), A, d.offer.id, "accept", "accept"), J.online(ctx.s(1), A, false, "offline")], i);
        ctx.check(rs[1].ok, "set_rider_online(false) always succeeds", rs[1].err);
        const o = outcome(rs[0]);
        const rider = (await ctx.admin.q(`select rider_id from orders where id = $1`, [d.order])).rows[0].rider_id;
        if (o === "accepted") {
          ctx.check(rider === A, "accepted cleanly before the offline");
          ctx.stat("accept_won_before_offline");
        } else {
          ctx.check(o === "ineligible" && val(rs[0]).reason === "location" && rider === null, "else refused and unassigned", val(rs[0]) ?? rs[0].err);
          await fx.makeDue(d.order);
          await race(ctx, [J.tickOrder(ctx.s(2), d.order)], 1);
          const offers = await fx.offers(d.order);
          const live = offers.find((x) => x.status === "offered");
          ctx.check(offers[0].status === "cancelled" && live && live.rider_id !== A, "offer cancelled and the next rider offered", offers.map((x) => [x.attempt_no, x.status]));
          ctx.stat("offline_won_next_rider_offered");
        }
        const a = (await ctx.admin.q(`select is_online from riders where user_id = $1`, [A])).rows[0];
        ctx.check(a.is_online === false, "the rider is offline at the end", a);
      } else {
        // v === 2: another order gets assigned to the rider while their offer on this order is pending
        const [A, X] = await fx.riders([{ east: 1 }, { east: 2 }]);
        const o1 = await fx.order();
        const o2 = await fx.order();
        await fx.advance(o1); // A
        await fx.advance(o2); // X (A is excluded)
        const lx = await fx.liveOffer(o2);
        await ctx.admin.q(`update dispatch_offers set status = 'cancelled', close_reason = 'harness' where id = $1`, [lx.id]);
        await fx.directLiveOffer(o2, A, { cycle: lx.cycle_no, attempt: lx.attempt_no + 1 });
        await ctx.admin.q(`update order_dispatch set attempt_no = $2, state = 'offered' where order_id = $1`, [o2, lx.attempt_no + 1]);
        const rs = await race(ctx, [J.accept(ctx.s(0), A, o1, "accept-o1"), J.adminAssign(ctx.s(1), o2, A, fx.base.admin, "admin-assigns-o2")], i);
        ctx.check(count(rs, (r) => r.ok) === 1, "exactly one of accept / admin-assign got the rider", rs.map((r) => (r.ok ? "ok" : r.err.message)));
        const held = (await ctx.admin.q(`select count(*)::int n from orders where rider_id = $1 and status in ('accepted','preparing','rider_assigned')`, [A])).rows[0].n;
        ctx.check(held === 1, "the rider holds exactly one active order", held);
        // the order that did NOT get A: its pending offer to A is dead (A is busy); the next look re-offers
        const lost = rs[0].ok ? o2 : o1;
        await fx.makeDue(lost);
        await race(ctx, [J.tickOrder(ctx.s(2), lost)], 1);
        const offers = await fx.offers(lost);
        const dead = offers.filter((x) => x.rider_id === A);
        ctx.check(!offers.some((x) => x.rider_id === A && x.status === "offered"), "no live offer remains with the busy rider", offers.map((x) => [x.rider_id === A ? "A" : "X", x.status]));
        ctx.check(dead.length >= 1, "the busy rider's offer on the other order was closed", dead.map((x) => x.status));
        ctx.stat(rs[0].ok ? "accept_won" : "admin_assign_won");
      }
    },
  },

  {
    id: 11,
    name: "order cancelled (platform) mid-dispatch racing the accept: cancelled with no rider, or assigned-then-cancelled; live offer closed",
    iterations: 48,
    async run(ctx, i) {
      const status = early(i);
      const d = await dispatched(ctx, { n: 3, status });
      const A = d.holder;
      const useLegacy = i % 3 !== 0;
      const accept = useLegacy ? J.accept(ctx.s(0), A, d.order, "accept") : J.respond(ctx.s(0), A, d.offer.id, "accept", "accept");
      const rs = await race(ctx, [accept, J.cancelPlatform(ctx.s(1), d.order, "cancel")], i);
      if (!rs[1].ok) {
        ctx.check(false, "platform cancel of a paid dispatching order succeeds", rs[1].err);
        return;
      }
      const o = (await ctx.admin.q(`select status, rider_id from orders where id = $1`, [d.order])).rows[0];
      ctx.check(o.status === "cancelled_by_platform", "order ended cancelled", o);
      const acceptedOk = useLegacy ? rs[0].ok : outcome(rs[0]) === "accepted";
      if (acceptedOk) {
        ctx.check(o.rider_id === A, "accept won first: assigned, then cancelled (rider still recorded on the cancelled order)", o);
        const ev = (await ctx.admin.q(`select to_status from order_events where order_id = $1 order by id`, [d.order])).rows.map((r) => r.to_status);
        ctx.check(ev.lastIndexOf("cancelled_by_platform") === ev.length - 1, "the cancel event is the last one", ev);
        ctx.stat("assigned_then_cancelled");
      } else {
        ctx.check(o.rider_id === null, "cancel won first: no rider on the cancelled order", o);
        ctx.check(useLegacy ? !rs[0].ok : ["taken", "withdrawn"].includes(outcome(rs[0])), "the accept was refused", val(rs[0]) ?? rs[0].err);
        ctx.stat("cancelled_before_accept");
      }
      const live = (await ctx.admin.q(`select count(*)::int n from dispatch_offers where order_id = $1 and status = 'offered'`, [d.order])).rows[0].n;
      ctx.check(live === 0, "no live offer remains on the cancelled order", live);
      const busy = (await ctx.admin.q(`select count(*)::int n from orders where rider_id = $1 and status in ('accepted','preparing','rider_assigned','picked_up','in_transit','arrived')`, [A])).rows[0].n;
      ctx.check(busy === 0, "the rider is not left holding a cancelled order as active", busy);
      const od0 = (await ctx.admin.q(`select state from order_dispatch where order_id = $1`, [d.order])).rows[0].state;
      ctx.check(od0 === "stopped", "right after the race the dispatch state is 'stopped' (cancel trigger)", od0);
      // a late tick must not resurrect anything
      await race(ctx, [J.tickOrder(ctx.s(2), d.order), J.sweep(ctx.s(3))], 1);
      const od1 = (await ctx.admin.q(`select state from order_dispatch where order_id = $1`, [d.order])).rows[0].state;
      if (od1 !== od0) ctx.stat("OBSERVATION_state_flipped_stopped_to_" + od1);
      const after = await ctx.fx.offers(d.order);
      ctx.check(!after.some((x) => x.status === "offered"), "tick after cancel makes no offer", after.map((x) => x.status));
    },
  },

  {
    id: 12,
    name: "decline racing the tick (and repeated declines): exactly one new live offer, declined rider never re-asked",
    iterations: 48,
    async run(ctx, i) {
      const d = await dispatched(ctx, { n: 3, status: early(i) });
      const A = d.holder;
      const rs = await race(
        ctx,
        [
          J.decline(ctx.s(0), A, d.order, "decline-legacy"),
          J.respond(ctx.s(1), A, d.offer.id, "decline", "decline-respond-1"),
          J.respond(ctx.s(2), A, d.offer.id, "decline", "decline-respond-2"),
          J.tickOrder(ctx.s(3), d.order, "tick1"),
          J.tickOrder(ctx.s(4), d.order, "tick2"),
          J.sweep(ctx.s(5)),
        ],
        i,
      );
      for (const r of rs) ctx.check(r.ok, `${r.label} succeeded (repeat declines return the closed offer)`, r.err);
      const offers = await ctx.fx.offers(d.order);
      const live = offers.filter((o) => o.status === "offered");
      ctx.check(live.length === 1 && live[0].rider_id === d.riders[1], "exactly one live offer, to the next rider", offers.map((o) => [o.attempt_no, o.status]));
      ctx.check(offers.length === 2 && offers[0].status === "declined", "A's offer declined once; only one new offer", offers.map((o) => [o.attempt_no, o.status]));
      ctx.check(!offers.slice(1).some((o) => o.rider_id === A), "the declined rider is not asked again", offers.map((o) => o.rider_id === A));
      const ev = (await ctx.admin.q(`select count(*)::int n from dispatch_events where order_id = $1 and event = 'offer_declined'`, [d.order])).rows[0].n;
      ctx.check(ev === 1, "one offer_declined event", ev);
      ctx.stat("new_live_offers", live.length);
    },
  },
];
