import { describe, expect, it } from "vitest";
import { FINDING_RIDER_TEXT, riderArrivalText, riderStatusLines, searchHasStarted } from "./dispatch-progress";
import { parseDispatchState, type VendorDispatchState } from "./self-delivery";

const NOW = Date.parse("2026-10-25T15:00:00Z");

function view(overrides: Record<string, unknown>): VendorDispatchState {
  const parsed = parseDispatchState({ state: "offers_pending", ...overrides }, NOW);
  if (!parsed) throw new Error("fixture is not a dispatch state");
  return parsed;
}

describe("searchHasStarted", () => {
  it("starts at once for a ready order, whatever the planned time says", () => {
    expect(searchHasStarted({ startAt: "2026-10-25T16:00:00Z", engineState: "scheduled" }, "ready_for_pickup", NOW)).toBe(true);
  });
  it("follows the planned start time for food still being made", () => {
    expect(searchHasStarted({ startAt: "2026-10-25T15:10:00Z", engineState: "scheduled" }, "preparing", NOW)).toBe(false);
    // The engine state can lag the clock by a tick: the planned time wins.
    expect(searchHasStarted({ startAt: "2026-10-25T14:59:00Z", engineState: "scheduled" }, "preparing", NOW)).toBe(true);
  });
  it("falls back on the engine state when there is no planned time", () => {
    expect(searchHasStarted({ startAt: null, engineState: "scheduled" }, "accepted", NOW)).toBe(false);
    expect(searchHasStarted({ startAt: null, engineState: "searching" }, "accepted", NOW)).toBe(true);
    expect(searchHasStarted({ startAt: null, engineState: null }, "accepted", NOW)).toBe(true);
  });
});

describe("riderStatusLines", () => {
  it("says riders are asked one at a time while searching, plus the ready time for food still being made", () => {
    const dispatch = view({ dispatch_state: "offered", start_at: "2026-10-25T14:50:00Z", expected_ready_at: "2026-10-25T15:20:00Z" });
    expect(riderStatusLines(dispatch, "preparing", NOW)).toEqual([FINDING_RIDER_TEXT, "Food expected ready at 16:20"]);
    expect(FINDING_RIDER_TEXT).toBe("Finding a rider: asking riders one at a time, nearest first.");
  });
  it("leaves the ready time out once the food is ready", () => {
    const dispatch = view({ dispatch_state: "searching", expected_ready_at: "2026-10-25T14:55:00Z" });
    expect(riderStatusLines(dispatch, "ready_for_pickup", NOW)).toEqual([FINDING_RIDER_TEXT]);
  });
  it("shows when food is expected and when the search starts while scheduled (Lagos time)", () => {
    const dispatch = view({ dispatch_state: "scheduled", start_at: "2026-10-25T15:12:00Z", expected_ready_at: "2026-10-25T15:30:00Z" });
    expect(riderStatusLines(dispatch, "accepted", NOW)).toEqual(["Food expected ready at 16:30", "Rider search starts around 16:12"]);
  });
  it("says nothing it does not know", () => {
    expect(riderStatusLines(view({ dispatch_state: "scheduled" }), "accepted", NOW)).toEqual([]);
  });
  it("tells the store how soon an assigned rider arrives", () => {
    const dispatch = view({ state: "rider_assigned", dispatch_state: "assigned", assigned_eta_at: "2026-10-25T15:06:30Z" });
    expect(riderStatusLines(dispatch, "rider_assigned", NOW)).toEqual(["Rider arriving in about 7 min"]);
  });
  it("is silent when the store delivers or there is nothing to say", () => {
    expect(riderStatusLines(view({ state: "self_delivery" }), "ready_for_pickup", NOW)).toEqual([]);
    expect(riderStatusLines(view({ state: "no_rider_nearby" }), "ready_for_pickup", NOW)).toEqual([]);
    expect(riderStatusLines(view({ state: "rider_assigned" }), "rider_assigned", NOW)).toEqual([]);
  });
});

describe("riderArrivalText", () => {
  it("handles a rider who is due now, and an unknown time", () => {
    expect(riderArrivalText("2026-10-25T14:58:00Z", NOW)).toBe("Your rider should be arriving about now.");
    expect(riderArrivalText(null, NOW)).toBeNull();
  });
});
