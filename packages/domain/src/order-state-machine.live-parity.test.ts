import { describe, expect, it } from "vitest";
import { ALLOWED_TRANSITIONS } from "./order-state-machine";

// The 20 rows found in the LIVE order_status_transitions table on 2026-09-24
// (queried with `supabase db query --linked`). If this ever fails, either the
// domain table or the DB table drifted - see the header of
// order-state-machine.ts. The DB table was once found wiped (migration 0068).
const LIVE_ROWS = [
  "accepted>cancelled_by_platform",
  "accepted>preparing",
  "arrived>cancelled_by_platform",
  "arrived>delivered",
  "arrived>failed_delivery",
  "draft>placed",
  "in_transit>arrived",
  "in_transit>cancelled_by_platform",
  "picked_up>cancelled_by_platform",
  "picked_up>in_transit",
  "placed>accepted",
  "placed>cancelled_by_customer",
  "placed>cancelled_by_platform",
  "placed>rejected_by_vendor",
  "preparing>cancelled_by_platform",
  "preparing>ready_for_pickup",
  "ready_for_pickup>cancelled_by_platform",
  "ready_for_pickup>rider_assigned",
  "rider_assigned>cancelled_by_platform",
  "rider_assigned>picked_up",
];

describe("ALLOWED_TRANSITIONS vs live order_status_transitions", () => {
  it("has exactly the same 20 edges as the live table", () => {
    const domain = Object.entries(ALLOWED_TRANSITIONS)
      .flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`))
      .sort();
    expect(domain).toHaveLength(20);
    expect(domain).toEqual([...LIVE_ROWS].sort());
  });
});
