// Database invariants of the sequential dispatch (docs/dispatch-design.md D2, D12). Checked after EVERY
// iteration of EVERY scenario, over the orders that iteration created. Returns violation strings
// ([] = all hold). `soft` entries are design rules the schema does not enforce; they are reported
// separately so that a hard-invariant pass is never diluted.
const ACTIVE = `('accepted','preparing','rider_assigned','picked_up','in_transit','arrived')`;

const CHECKS = [
  {
    name: "at most one live offer per order",
    sql: `select order_id, count(*) n from dispatch_offers where order_id = any($1) and status = 'offered' group by 1 having count(*) > 1`,
  },
  {
    name: "at most one accepted offer per order",
    sql: `select order_id, count(*) n from dispatch_offers where order_id = any($1) and status = 'accepted' group by 1 having count(*) > 1`,
  },
  {
    name: "orders.rider_id equals the accepted offer's rider (or both null)",
    sql: `select o.id order_id, o.rider_id, a.rider_id accepted_rider
          from orders o left join dispatch_offers a on a.order_id = o.id and a.status = 'accepted'
          where o.id = any($1) and o.rider_id is distinct from a.rider_id`,
  },
  {
    name: "no accepted offer was answered after its expiry (no expired offer ever won)",
    sql: `select order_id, id offer_id, expires_at, responded_at from dispatch_offers
          where order_id = any($1) and status = 'accepted' and responded_at > expires_at`,
  },
  {
    name: "no rider holds two active orders (whole database)",
    sql: `select rider_id, count(*) n from orders where rider_id is not null and status in ${ACTIVE} group by 1 having count(*) > 1`,
  },
  {
    name: "offer attempt numbers: unique, contiguous 1..n, and the cycle never goes backwards",
    sql: `with d as (
            select order_id, attempt_no, cycle_no, offered_at,
                   lag(cycle_no) over w pc, lag(attempt_no) over w pa
            from dispatch_offers where order_id = any($1) window w as (partition by order_id order by attempt_no))
          select order_id, attempt_no, cycle_no from d
          where (pa is not null and attempt_no <> pa + 1) or (pc is not null and cycle_no < pc)
          union all
          select order_id, min(attempt_no), max(attempt_no) from dispatch_offers where order_id = any($1)
          group by order_id having min(attempt_no) <> 1 or count(*) <> count(distinct attempt_no)`,
  },
  {
    name: "order_dispatch.attempt_no equals the last attempt; order_dispatch.cycle_no is at least the last offer's cycle",
    sql: `select od.order_id, od.attempt_no, od.cycle_no, m.a, m.c
          from order_dispatch od join (select order_id, max(attempt_no) a, max(cycle_no) c from dispatch_offers group by 1) m using (order_id)
          where od.order_id = any($1) and (od.attempt_no <> m.a or od.cycle_no < m.c)`,
  },
  {
    name: "order_dispatch state is consistent with orders / offers",
    sql: `select o.id order_id, o.status, o.rider_id, od.state, l.id live
          from orders o join order_dispatch od on od.order_id = o.id
          left join dispatch_offers l on l.order_id = o.id and l.status = 'offered'
          where o.id = any($1) and (
                (o.rider_id is not null and o.status not in ('cancelled_by_customer','cancelled_by_platform','rejected_by_vendor') and od.state <> 'assigned')
             or (l.id is not null and od.state <> 'offered')
             or (o.status in ('cancelled_by_customer','cancelled_by_platform','rejected_by_vendor') and od.state not in ('stopped') and not (o.rider_id is not null and od.state = 'assigned')))`,
  },
  {
    name: "no live offer on an assigned or closed order",
    sql: `select o.id order_id, o.status, o.rider_id from orders o
          where o.id = any($1) and exists (select 1 from dispatch_offers l where l.order_id = o.id and l.status = 'offered')
            and (o.rider_id is not null or o.status in ('cancelled_by_customer','cancelled_by_platform','rejected_by_vendor','delivered','failed_delivery'))`,
  },
  {
    name: "status and rider agree (rider_assigned and later => a rider; no rider => not yet assigned)",
    sql: `select id order_id, status, rider_id from orders where id = any($1)
          and ((status in ('rider_assigned','picked_up','in_transit','arrived','delivered') and rider_id is null)
            or (rider_id is null and status in ('rider_assigned','picked_up','in_transit','arrived')))`,
  },
  {
    name: "at most one rider-driven rider_assigned order_events row per order (an admin reassignment adds its own, by design)",
    sql: `select order_id, count(*) n from order_events where order_id = any($1) and to_status = 'rider_assigned' and actor_type = 'rider' group by 1 having count(*) > 1`,
  },
  {
    name: "at most one early-accept order_events row per order",
    sql: `select order_id, count(*) n from order_events where order_id = any($1) and (meta ->> 'early_accept') = 'true' group by 1 having count(*) > 1`,
  },
  {
    name: "at most one offer_accepted dispatch event per accepted offer",
    sql: `select offer_id, count(*) n from dispatch_events where order_id = any($1) and event = 'offer_accepted' and (data ->> 'path') is distinct from 'admin_assign' group by 1 having count(*) > 1`,
  },
  {
    name: "a closed offer's push is never left queued (late push suppressed)",
    sql: `select d.id offer_id, d.status, m.status push_status from dispatch_offers d
          join message_outbox m on m.dedupe_key = 'offer:' || d.id || ':push'
          where d.order_id = any($1) and d.status <> 'offered' and m.status = 'queued'`,
  },
  {
    name: "every live offer has exactly one push row",
    sql: `select d.id offer_id from dispatch_offers d
          where d.order_id = any($1) and d.status = 'offered'
            and (select count(*) from message_outbox m where m.dedupe_key = 'offer:' || d.id || ':push') <> 1`,
  },
  {
    name: "no rider holds more than one live unexpired offer (D1; fixed by 0107, engine locks the rider)",
    sql: `select rider_id, count(*) n from dispatch_offers where status = 'offered' and expires_at > now() group by 1 having count(*) > 1`,
  },
];

const SOFT = [];

export async function checkInvariants(admin, orderIds) {
  const hard = [];
  const soft = [];
  for (const [list, out] of [
    [CHECKS, hard],
    [SOFT, soft],
  ]) {
    for (const c of list) {
      const { rows } = await admin.q(c.sql, c.sql.includes("$1") ? [orderIds] : []);
      if (rows.length) out.push(`${c.name}: ${JSON.stringify(rows.slice(0, 3))}`);
    }
  }
  return { hard, soft };
}

export const INVARIANT_COUNT = CHECKS.length;
