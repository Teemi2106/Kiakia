// Builders for the calls the scenarios race. Each returns a job for runConcurrent():
// { sess, as: 'rider'|'service'|'postgres', uid?, sql, label }.
import { u } from "./db.mjs";

export const J = {
  /** legacy rider RPC: raises on every loser. */
  accept: (sess, uid, orderId, label = "accept") => ({
    sess, as: "rider", uid, label,
    sql: `select to_jsonb(a) as r from accept_dispatch_offer(${u(orderId)}) a`,
  }),
  decline: (sess, uid, orderId, label = "decline") => ({
    sess, as: "rider", uid, label,
    sql: `select to_jsonb(d) as r from decline_dispatch_offer(${u(orderId)}) d`,
  }),
  /** outcome-returning twin: never raises for normal races. */
  respond: (sess, uid, offerId, action = "accept", label = "respond") => ({
    sess, as: "rider", uid, label,
    sql: `select respond_to_dispatch_offer(${u(offerId)}, '${action}') as r`,
  }),
  getOffer: (sess, uid, offerId, label = "get_offer") => ({
    sess, as: "rider", uid, label,
    sql: `select get_dispatch_offer(${u(offerId)}) as r`,
  }),
  online: (sess, uid, on, label = "set_online") => ({
    sess, as: "rider", uid, label,
    sql: `select to_jsonb(r) as r from set_rider_online(${on ? "true" : "false"}) r`,
  }),
  /** what the worker runs per due order */
  tickOrder: (sess, orderId, label = "tick_order") => ({
    sess, as: "postgres", label,
    sql: `select _dispatch_tick_order(${u(orderId)}, 'tick', now() - interval '1 minute') as r`,
  }),
  advance: (sess, orderId, label = "advance") => ({
    sess, as: "postgres", label,
    sql: `select _dispatch_advance(${u(orderId)}, 'tick', false) as r`,
  }),
  tickRun: (sess, label = "tick_run") => ({
    sess, as: "postgres", label,
    sql: `select _dispatch_tick_run(200, 'tick') as r`,
  }),
  sweep: (sess, label = "sweep") => ({
    sess, as: "service", label,
    sql: `select to_jsonb(s) as r from sweep_dispatch_offers() s`,
  }),
  adminAssign: (sess, orderId, riderId, adminId, label = "admin_assign") => ({
    sess, as: "service", label,
    sql: `select to_jsonb(o) as r from admin_reassign_order_rider(${u(orderId)}, ${u(riderId)}, 'concurrency harness', ${u(adminId)}) o`,
  }),
  adminUnassign: (sess, orderId, adminId, label = "admin_unassign") => ({
    sess, as: "service", label,
    sql: `select to_jsonb(o) as r from admin_reassign_order_rider(${u(orderId)}, null, 'concurrency harness', ${u(adminId)}) o`,
  }),
  cancelPlatform: (sess, orderId, label = "cancel") => ({
    sess, as: "service", label,
    sql: `select to_jsonb(o) as r from transition_order(${u(orderId)}, 'cancelled_by_platform', 'system', null, '{"reason":"concurrency harness"}'::jsonb) o`,
  }),
  rawSql: (sess, sql, label = "sql", as = "postgres") => ({ sess, as, label, sql }),
};

/** The jsonb result of a job, or null. */
export const val = (r) => (r.ok ? (r.rows[0]?.r ?? null) : null);
/** outcome string of respond_to_dispatch_offer */
export const outcome = (r) => (r.ok ? (val(r)?.outcome ?? null) : null);
