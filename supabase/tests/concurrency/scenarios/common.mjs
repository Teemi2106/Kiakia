import { runConcurrent } from "../lib/db.mjs";

/** An order (ready or early) with n online riders at 110 m, 220 m, ...; the engine makes the first offer. */
export async function dispatched(ctx, { n = 3, status = "ready_for_pickup", phone = false } = {}) {
  const fx = ctx.fx;
  const riders = await fx.riders(Array.from({ length: n }, (_, k) => ({ east: k + 1, phone })));
  const order = await fx.order({ status });
  const adv = await fx.advance(order);
  const offer = await fx.liveOffer(order);
  return { order, riders, adv, offer, holder: offer?.rider_id ?? null };
}

export const early = (i) => (i % 2 === 0 ? "preparing" : "ready_for_pickup");

/** Run jobs together; barrier on by default, every 4th iteration free-fire for different interleavings. */
export function race(ctx, jobs, i = 1) {
  return runConcurrent(ctx.gate, jobs, { barrier: i % 4 !== 0, jitterMs: [0, 8, 25][i % 3] });
}

export const count = (rs, f) => rs.filter(f).length;

/**
 * An isolated cluster: its own vendor ~66 km from every other cluster (k apart) and `n` riders 110 m, 220 m, ... east
 * of it, so several orders can be dispatched in one iteration without the riders of one competing for another.
 */
export async function cluster(ctx, k, { n = 2, status = "ready_for_pickup", readyAgoSec = 0, phone = false } = {}) {
  const fx = ctx.fx;
  const lat = 9.5 + k * 0.6;
  const lng = 7.5;
  const vendor = await fx.vendor(lat, lng);
  const riders = await fx.riders(Array.from({ length: n }, (_, j) => ({ lat, lng: lng + (j + 1) * 0.001, phone })));
  const order = await fx.order({ vendor, status, readyAgoSec });
  return { vendor, riders, order, lat, lng };
}
