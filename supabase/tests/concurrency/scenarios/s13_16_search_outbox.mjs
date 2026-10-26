// Scenarios 13-16: exhausting candidates, H3 ring expansion, outbox atomicity / crash, notification dedupe.
import { u, riderPrelude, servicePrelude, waitBlocked, sleep } from "../lib/db.mjs";
import { J, val, outcome } from "../lib/jobs.mjs";
import { cluster, dispatched, race, count } from "./common.mjs";

/** Age the live offer: delete and re-insert the same rider/cycle/attempt already lapsed (offered_at/expires_at are immutable). */
async function lapseLive(ctx, order) {
  const { rows } = await ctx.admin.q(`delete from dispatch_offers where order_id = $1 and status = 'offered' returning *`, [order]);
  const r = rows[0];
  await ctx.admin.q(
    `insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at, ring, distance_m, eta_seconds)
     values ($1, $2, 'offered', $3, $4, now() - interval '3 minutes', now() - interval '1 second', $5, $6, $7)`,
    [r.order_id, r.rider_id, r.cycle_no, r.attempt_no, r.ring, r.distance_m, r.eta_seconds],
  );
  return r.rider_id;
}

let GEO = null;
/**
 * East offsets (degrees of longitude from the base vendor, lat 9.5) at which the H3 grid distance (resolution 8) first reaches
 * each ring. Cells are taken as the res-8 PARENT of the res-9 cell (what the engine's descendant-range scan sees); that is not
 * always the res-8 cell that contains the point (H3 is not perfectly nested), so a direct res-8 lookup would be off at borders.
 */
async function ringGeometry(ctx) {
  if (GEO) return GEO;
  const { rows } = await ctx.admin.q(
    `with v as (select h3_latlng_to_cell(9.5, 7.5, 8) vc),
          d as (select g.cell, g.k from v, h3_grid_disk_distances(v.vc, 14) g),
          pts as (select off, h3_cell_to_parent(h3_latlng_to_cell(9.5, 7.5 + off, 9), 8) cell from generate_series(0, 0.2, 0.0002) off)
     select d.k, min(p.off)::float8 first_off, max(p.off)::float8 last_off from pts p join d using (cell) group by d.k order by d.k`,
  );
  GEO = Object.fromEntries(rows.map((r) => [r.k, { first: Number(r.first_off), last: Number(r.last_off) }]));
  return GEO;
}

export default [
  {
    id: 13,
    name: "all candidates decline / time out: new cycles, declined never re-asked, needs_attention per the rules",
    iterations: 10,
    async run(ctx, i) {
      const fx = ctx.fx;
      const { riders: [A, B, C], order } = await cluster(ctx, i % 30, { n: 3, readyAgoSec: i % 2 ? 0 : 120 });
      const first = await fx.advance(order);
      ctx.check(first.outcome === "offered" && (await fx.liveOffer(order)).rider_id === A, "offer 1 to A", first);
      // A declines -> B inline
      const d1 = await race(ctx, [J.decline(ctx.s(0), A, order)], 1);
      ctx.check(d1[0].ok, "A's decline succeeded", d1[0].err);
      ctx.check((await fx.liveOffer(order))?.rider_id === B, "decline asked B in the same transaction");
      // B lapses -> C
      await lapseLive(ctx, order);
      await race(ctx, [J.tickOrder(ctx.s(1), order)], 1);
      ctx.check((await fx.liveOffer(order))?.rider_id === C, "B timed out, C asked");
      // C declines -> cycle 1 is used up; cycle 2 re-asks only B (A and C declined = never again)
      await race(ctx, [J.decline(ctx.s(2), C, order)], 1);
      let live = await fx.liveOffer(order);
      ctx.check(live?.rider_id === B && live.cycle_no === 2, "cycle 2 starts and re-asks only the timed-out rider", live);
      // B lapses again -> cycle 3 (re-asks B), needs_attention (two cycles without accept)
      await lapseLive(ctx, order);
      await race(ctx, [J.tickOrder(ctx.s(3), order)], 1);
      live = await fx.liveOffer(order);
      ctx.check(live?.rider_id === B && live.cycle_no === 3, "cycle 3 re-asks B", live);
      let od = (await ctx.admin.q(`select * from order_dispatch where order_id = $1`, [order])).rows[0];
      ctx.check(od.needs_attention_since && od.attention_reason === "two_cycles_without_accept", "needs_attention raised after two full cycles", { reason: od.attention_reason });
      // B declines (racing two ticks): nobody is left
      const last = await race(ctx, [J.decline(ctx.s(4), B, order), J.tickOrder(ctx.s(5), order), J.tickOrder(ctx.s(6), order)], i);
      ctx.check(last.every((r) => r.ok), "final decline + ticks all succeeded", last.map((r) => r.err));
      for (let k = 0; k < 3; k++) {
        await fx.makeDue(order);
        await race(ctx, [J.tickOrder(ctx.s(7), order), J.sweep(ctx.s(8))], 1);
      }
      const offers = await fx.offers(order);
      ctx.check(!offers.some((o) => o.status === "offered"), "no live offer: every candidate is exhausted", offers.map((o) => [o.attempt_no, o.status]));
      ctx.check(offers.filter((o) => o.rider_id === A).length === 1 && offers.filter((o) => o.rider_id === C).length === 1, "declined A and C were asked exactly once, ever", offers.map((o) => [o.rider_id === A ? "A" : o.rider_id === B ? "B" : "C", o.cycle_no, o.status]));
      ctx.check(offers.length === 5, "five offers in total (A, B, C, B, B) - the extra ticks made none", offers.length);
      od = (await ctx.admin.q(`select * from order_dispatch where order_id = $1`, [order])).rows[0];
      ctx.check(od.state === "needs_attention", "order_dispatch.state = needs_attention", od.state);
      const ev = (await ctx.admin.q(`select event, count(*)::int n from dispatch_events where order_id = $1 and event in ('needs_attention','no_candidates','cycle_started') group by 1`, [order])).rows;
      const evm = Object.fromEntries(ev.map((e) => [e.event, e.n]));
      ctx.check(evm.needs_attention === 1, "needs_attention event written once", evm);
      ctx.check(evm.no_candidates >= 1, "no_candidates recorded", evm);
      ctx.stat("cycles_reached", od.cycle_no);
    },
  },

  {
    id: 14,
    name: "no rider in the initial area: search widens ring by ring (H3 res 8), a rider across a cell boundary is found; ring asserted",
    iterations: 24,
    async run(ctx, i) {
      const fx = ctx.fx;
      const geo = await ringGeometry(ctx);
      if (i % 9 === 0) {
        // a rider just across the cell boundary (ring 1, ~20 m beyond the last ring-0 point) is found once the ring-0 rider is out
        const r0 = await fx.rider({ lng: 7.5 + geo[0].last - 0.00005, lat: 9.5 });
        const r1 = await fx.rider({ lng: 7.5 + geo[1].first + 0.00005, lat: 9.5 });
        const order = await fx.order();
        await fx.advance(order);
        const o0 = await fx.liveOffer(order);
        ctx.check(o0?.rider_id === r0 && o0.ring === 0, "the ring-0 rider is asked first, ring 0", o0);
        await race(ctx, [J.decline(ctx.s(0), r0, order)], 1);
        const o1 = await fx.liveOffer(order);
        ctx.check(o1?.rider_id === r1 && o1.ring === 1, "then the rider across the cell boundary is found, ring 1", o1);
        ctx.stat("boundary_pair_ok");
        return;
      }
      const rings = [0, 1, 2, 3, 5, 8, 9, 10];
      const k = rings[i % rings.length];
      ctx.check(geo[k], `geometry has a point at ring ${k}`);
      const east = (geo[k].first + geo[k].last) / 2; // the middle of the band where the grid distance is k
      const rider = await fx.rider({ lng: 7.5 + east, lat: 9.5 });
      const order = await fx.order();
      const adv = await fx.advance(order);
      ctx.check(adv.outcome === "offered", "a rider at that distance is found", adv);
      const offer = await fx.liveOffer(order);
      ctx.check(offer?.rider_id === rider, "the offer goes to that rider", offer);
      const expectedRing = (await ctx.admin.q(
        `select g.k from riders r, h3_grid_disk_distances(h3_latlng_to_cell(9.5, 7.5, 8), 14) g
         where r.user_id = $1 and g.cell = h3_cell_to_parent(r.h3_cell, 8)`,
        [rider],
      )).rows[0]?.k;
      const maxRing = 8;
      const initial = 1;
      if (k <= maxRing) {
        ctx.check(expectedRing === k, `the test rider is really at ring ${k} (independent SQL check)`, { expectedRing });
        ctx.check(offer.ring === k, `offer.ring = ${k}`, offer.ring);
        ctx.check(adv.stage === "rings", "stage rings", adv.stage);
      } else {
        ctx.check(offer.ring === null && adv.stage === "beyond_rings", "beyond the last ring: PostGIS fallback, offer.ring is null", { ring: offer.ring, stage: adv.stage });
      }
      const exp = (await ctx.admin.q(`select data from dispatch_events where order_id = $1 and event = 'ring_expanded'`, [order])).rows;
      if (k > initial) {
        ctx.check(exp.length === 1 && exp[0].data.from === initial && exp[0].data.to === Math.min(k, maxRing), "ring_expanded event 1 -> target (or the max)", exp.map((e) => e.data));
      } else {
        ctx.check(exp.length === 0, "no expansion needed inside the first rings", exp.map((e) => e.data));
      }
      const od = (await ctx.admin.q(`select ring from order_dispatch where order_id = $1`, [order])).rows[0];
      ctx.check(od.ring === (k <= maxRing ? k : null) || (k > maxRing && od.ring === maxRing), "order_dispatch.ring follows the last offer", { ring: od.ring, k });
      ctx.stat(`ring_${k}_found`);
    },
  },

  {
    id: 15,
    name: "crash safety: killed session leaves neither offer nor outbox row; committed offer + push are atomic and claimable; killed accept leaves nothing",
    iterations: 12,
    async run(ctx, i) {
      const fx = ctx.fx;
      // ---- (a) backend killed before commit: no offer, no outbox row, no state row
      const c = await cluster(ctx, i % 30, { n: 2 });
      const S = ctx.s(0);
      await S.q("begin");
      await S.q(`select 1 from orders where id = ${u(c.order)} for update`);
      const adv = (await S.q(`select _dispatch_advance(${u(c.order)}, 'test', false) as r`)).rows[0].r;
      ctx.check(adv.outcome === "offered", "inside the open transaction the engine made an offer", adv);
      const inside = (await S.q(`select (select count(*)::int from dispatch_offers where id = ${u(adv.offer_id)}) o, (select count(*)::int from message_outbox where dedupe_key = 'offer:${adv.offer_id}:push') m`)).rows[0];
      ctx.check(inside.o === 1 && inside.m === 1, "the session itself sees offer + outbox row", inside);
      const outside = async () =>
        (await ctx.admin.q(
          `select (select count(*)::int from dispatch_offers where order_id = $1) offers,
                  (select count(*)::int from message_outbox where dedupe_key = 'offer:' || $2::text || ':push' or recipient_user_id = any($3::uuid[])) outbox,
                  (select count(*)::int from order_dispatch where order_id = $1) od,
                  (select count(*)::int from dispatch_events where order_id = $1) events`,
          [c.order, adv.offer_id, c.riders],
        )).rows[0];
      const before = await outside();
      ctx.check(before.offers === 0 && before.outbox === 0 && before.od === 0 && before.events === 0, "uncommitted: another session sees no offer, no outbox row, no state row, no events", before);
      await ctx.admin.q(`select pg_terminate_backend($1)`, [S.pid]);
      S.dead = true;
      await sleep(80);
      const after = await outside();
      ctx.check(after.offers === 0 && after.outbox === 0 && after.od === 0 && after.events === 0, "after pg_terminate_backend: still nothing (no half-written state)", after);
      const lock = await ctx.admin.q(`select 1 from orders where id = $1 for update nowait`, [c.order]).then(() => true, () => false);
      ctx.check(lock, "the killed session released the order lock");
      // ---- (b) commit: offer and push exist together; the message-worker claim path can pick the push up
      const adv2 = await fx.advance(c.order);
      const offer = await fx.liveOffer(c.order);
      ctx.check(adv2.outcome === "offered" && offer, "a normal committed advance offers", adv2);
      const push = (await ctx.admin.q(`select * from message_outbox where dedupe_key = $1`, [`offer:${offer.id}:push`])).rows[0];
      ctx.check(
        push && push.kind === "rider_offer" && push.channel === "push" && push.status === "queued" && push.recipient_user_id === offer.rider_id &&
          push.data?.offerId === offer.id && push.data?.orderId === c.order && push.data?.type === "dispatch_offer" &&
          new Date(push.expires_at).getTime() === offer.expires_at.getTime(),
        "committed offer has its queued push (kind rider_offer, data.offerId, expires_at = offer expiry)",
        push,
      );
      const claim = async (sess, limit = 50) => {
        await sess.q(`begin; ${servicePrelude()}`);
        const r = await sess.q(`select id, status, dedupe_key, data from message_claim_batch(${limit})`);
        return r.rows;
      };
      const w1 = ctx.s(1);
      const w2 = ctx.s(2);
      const got1 = await claim(w1);
      ctx.check(got1.some((r) => r.id === push.id && r.status === "sending"), "message_claim_batch (service role) claims the committed push", got1.map((r) => r.dedupe_key));
      const got2 = await claim(w2);
      ctx.check(!got2.some((r) => r.id === push.id), "a second worker does not get the same row (SKIP LOCKED)", got2.map((r) => r.dedupe_key));
      await w1.q("rollback");
      await w2.q("rollback");
      const still = (await ctx.admin.q(`select status, attempts from message_outbox where id = $1`, [push.id])).rows[0];
      ctx.check(still.status === "queued" && still.attempts === 0, "rolled-back claims left the row queued (nothing was sent)", still);
      // ---- (c) a killed ACCEPT leaves nothing; the retry commits the assignment and its side effects together
      const rider = offer.rider_id;
      const X = ctx.s(3);
      await X.q(`begin; ${riderPrelude(rider)}`);
      await X.q(`select accept_dispatch_offer(${u(c.order)})`);
      const seen = (await X.q(`select rider_id from orders where id = ${u(c.order)}`)).rows[0].rider_id;
      ctx.check(seen === rider, "inside its own transaction the accept assigned the rider");
      const o1 = (await ctx.admin.q(`select rider_id from orders where id = $1`, [c.order])).rows[0].rider_id;
      ctx.check(o1 === null, "uncommitted accept is invisible to others");
      await ctx.admin.q(`select pg_terminate_backend($1)`, [X.pid]);
      X.dead = true;
      await sleep(80);
      const st = (await ctx.admin.q(
        `select (select rider_id from orders where id = $1) rider,
                (select status from dispatch_offers where id = $2) offer,
                (select count(*)::int from order_events where order_id = $1) events,
                (select state from order_dispatch where order_id = $1) state,
                (select status from message_outbox where id = $3) push`,
        [c.order, offer.id, push.id],
      )).rows[0];
      ctx.check(st.rider === null && st.offer === "offered" && st.events === 0 && st.state === "offered" && st.push === "queued", "after the kill: unassigned, offer live, no events, push still queued", st);
      const retry = await race(ctx, [J.respond(ctx.s(4), rider, offer.id, "accept")], 1);
      ctx.check(outcome(retry[0]) === "accepted", "the retry commits the assignment", val(retry[0]) ?? retry[0].err);
      const fin = (await ctx.admin.q(
        `select (select rider_id from orders where id = $1) rider,
                (select count(*)::int from order_events where order_id = $1) events,
                (select state from order_dispatch where order_id = $1) state,
                (select count(*)::int from dispatch_events where order_id = $1 and event = 'offer_accepted') accepted_ev,
                (select status || '/' || coalesce(suppress_reason, '-') from message_outbox where id = $2) push`,
        [c.order, push.id],
      )).rows[0];
      ctx.check(fin.rider === rider && fin.events === 1 && fin.state === "assigned" && fin.accepted_ev === 1, "assignment, order event, dispatch state and event all committed together", fin);
      ctx.check(fin.push === "suppressed/expired", "the now-pointless offer push is suppressed in the same commit (late push never goes out)", fin.push);
      const got3 = await claim(ctx.s(5));
      await ctx.s(5).q("rollback");
      ctx.check(!got3.some((r) => r.id === push.id), "a closed offer's push is not claimable", got3.length);
      ctx.stat("killed_before_commit_clean");
      ctx.stat("killed_accept_clean");
    },
  },

  {
    id: 16,
    name: "notifications duplicated / late / out of order: dedupe_key holds, late push suppressed, get_dispatch_offer authoritative",
    iterations: 12,
    async run(ctx, i) {
      const fx = ctx.fx;
      // ---- (a) concurrent duplicate enqueues
      const [R] = await fx.riders([{ east: 1, online: false }]);
      const key = `harness:${fx.run}:${i}:dup`;
      const ins = (k) =>
        `insert into message_outbox (kind, channel, category, recipient_user_id, body, data, dedupe_key)
         values ('rider_offer', 'push', 'transactional', ${u(R)}, 'dup', '{}'::jsonb, '${key}')${k ? " on conflict (dedupe_key) do nothing" : ""} returning id as r`;
      const a1 = await race(ctx, Array.from({ length: 8 }, (_, k) => J.rawSql(ctx.s(k), ins(true), `dup${k}`)), i);
      ctx.check(a1.every((r) => r.ok), "ON CONFLICT DO NOTHING enqueues never error", a1.map((r) => r.err));
      const n1 = (await ctx.admin.q(`select count(*)::int n from message_outbox where dedupe_key = $1`, [key])).rows[0].n;
      ctx.check(n1 === 1, "8 concurrent duplicate enqueues -> exactly one row", n1);
      await ctx.admin.q(`delete from message_outbox where dedupe_key = $1`, [key]);
      const a2 = await race(ctx, Array.from({ length: 8 }, (_, k) => J.rawSql(ctx.s(k), ins(false), `raw${k}`)), i);
      ctx.check(count(a2, (r) => r.ok) === 1 && a2.filter((r) => !r.ok).every((r) => r.err.code === "23505"), "without ON CONFLICT: one insert wins, the rest get 23505", a2.map((r) => (r.ok ? "ok" : r.err.code)));
      // SMS fallback enqueue: the cron function run by 4 workers at once, for an offer old enough to qualify
      const [P] = await fx.riders([{ east: 2, phone: true }]);
      const o2 = await fx.order();
      const { rows: [smsOffer] } = await ctx.admin.q(
        `insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
         values ($1, $2, 'offered', 1, 1, now() - interval '20 seconds', now() + interval '25 seconds') returning id`,
        [o2, P],
      );
      const sms = await race(ctx, Array.from({ length: 4 }, (_, k) => J.rawSql(ctx.s(k), `select enqueue_rider_offer_sms() as r`, `sms${k}`, "service")), i);
      ctx.check(sms.every((r) => r.ok), "enqueue_rider_offer_sms ran in 4 sessions without error", sms.map((r) => r.err));
      const smsRows = (await ctx.admin.q(`select count(*)::int n from message_outbox where dedupe_key = $1`, [`offer:${smsOffer.id}:sms`])).rows[0].n;
      ctx.check(smsRows === 1, "4 concurrent enqueue runs -> exactly one SMS row for the offer", smsRows);
      ctx.stat("sms_queued_total", sms.reduce((n, r) => n + (r.ok ? Number(r.rows[0]?.r ?? 0) : 0), 0));

      // ---- (b) late push for a closed offer, authoritative state
      const d = await dispatched(ctx, { n: 3 });
      const [A, B, C] = d.riders;
      const offerA = d.offer;
      const pushA = (await ctx.admin.q(`select id, status from message_outbox where dedupe_key = $1`, [`offer:${offerA.id}:push`])).rows[0];
      ctx.check(pushA?.status === "queued", "A's push is queued while the offer is live", pushA);
      await race(ctx, [J.decline(ctx.s(0), A, d.order)], 1); // A out, B asked
      const offerB = await fx.liveOffer(d.order);
      ctx.check(offerB?.rider_id === B, "B holds the next offer", offerB);
      const pa = (await ctx.admin.q(`select status, suppress_reason from message_outbox where id = $1`, [pushA.id])).rows[0];
      ctx.check(pa.status === "suppressed" && pa.suppress_reason === "expired", "A's late push is suppressed the moment the offer closes", pa);
      const claimed = await (async () => {
        await ctx.s(1).q(`begin; ${servicePrelude()}`);
        const r = await ctx.s(1).q(`select dedupe_key from message_claim_batch(50)`);
        await ctx.s(1).q("rollback");
        return r.rows.map((x) => x.dedupe_key);
      })();
      ctx.check(!claimed.includes(`offer:${offerA.id}:push`) && claimed.includes(`offer:${offerB.id}:push`), "the worker can claim B's push but not A's", claimed.filter((k) => k.includes(offerA.id) || k.includes(offerB.id)));
      const g = await race(ctx, [J.getOffer(ctx.s(2), A, offerA.id, "A-sees-A"), J.getOffer(ctx.s(3), B, offerA.id, "B-sees-A"), J.getOffer(ctx.s(4), B, offerB.id, "B-sees-B"), J.getOffer(ctx.s(5), A, offerB.id, "A-sees-B")], i);
      const gv = Object.fromEntries(g.map((r) => [r.label, val(r)]));
      ctx.check(gv["A-sees-A"].status === "declined" && gv["A-sees-A"].actionable === false && gv["A-sees-A"].order === null, "get_dispatch_offer: A's closed offer is declined, not actionable, no order details", gv["A-sees-A"]);
      ctx.check(gv["B-sees-A"].outcome === "not_found" && gv["A-sees-B"].outcome === "not_found", "another rider's offer id answers not_found", [gv["B-sees-A"], gv["A-sees-B"]]);
      ctx.check(gv["B-sees-B"].status === "offered" && gv["B-sees-B"].actionable === true, "B's live offer is actionable", gv["B-sees-B"]);
      // out of order: B's push was already claimed and sent (committed), then the offer is superseded by an admin assignment
      await ctx.admin.q(`update message_outbox set status = 'sent', sent_at = now(), attempts = 1 where dedupe_key = $1`, [`offer:${offerB.id}:push`]);
      const adm = await race(ctx, [J.adminAssign(ctx.s(6), d.order, C, fx.base.admin, "assign1"), J.adminAssign(ctx.s(7), d.order, C, fx.base.admin, "assign2")], i);
      ctx.check(adm.every((r) => r.ok), "both (duplicate) admin assignments return", adm.map((r) => r.err));
      const wd = (await ctx.admin.q(`select recipient_user_id, data from message_outbox where dedupe_key = $1`, [`offer:${offerB.id}:withdrawn`])).rows;
      ctx.check(wd.length === 1 && wd[0].recipient_user_id === B && wd[0].data.type === "dispatch_offer_withdrawn", "exactly one 'withdrawn' push for the told rider", wd);
      const gB = await race(ctx, [J.getOffer(ctx.s(2), B, offerB.id, "B-after")], 1);
      const gbv = val(gB[0]);
      ctx.check(gbv.status === "superseded" && gbv.actionable === false && gbv.close_reason === "admin_assigned", "get_dispatch_offer: B's offer is authoritatively superseded/admin_assigned", gbv);
      const rider = (await ctx.admin.q(`select rider_id from orders where id = $1`, [d.order])).rows[0].rider_id;
      ctx.check(rider === C, "C holds the order", rider);
    },
  },
];
