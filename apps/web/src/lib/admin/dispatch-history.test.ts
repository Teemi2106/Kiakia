import { describe, expect, it } from "vitest";
import { describeDispatchEvent, describeOfferOutcome, formatResponseTime, readDispatchHistory } from "./dispatch-history";

const offer = (overrides: Record<string, unknown> = {}) => ({
  offer_id: "f1",
  rider_id: "r1",
  rider_name: "Ada Bello",
  cycle_no: 1,
  attempt_no: 1,
  ring: 1,
  radius_m: null,
  distance_m: 900,
  eta_seconds: 200,
  status: "declined",
  close_reason: null,
  offered_at: "2026-10-21T16:00:00Z",
  expires_at: "2026-10-21T16:00:45Z",
  responded_at: "2026-10-21T16:00:12Z",
  seconds_to_respond: 12,
  ...overrides,
});

const document = {
  order: { id: "o1", code: "KK-1001", status: "ready_for_pickup", delivery_by: "rider", rider_id: null },
  dispatch: {
    state: "offered",
    cycle_no: 1,
    start_at: "2026-10-21T15:50:00Z",
    expected_ready_at: "2026-10-21T16:00:00Z",
    assigned_at: null,
    assigned_eta_at: null,
    current_eta_at: null,
    rider_arrived_vendor_at: null,
    attention_reason: null,
  },
  offers: [
    offer(),
    offer({ offer_id: "f2", rider_id: "r2", rider_name: "Tunde Ade", attempt_no: 2, status: "expired", close_reason: "timeout", responded_at: "2026-10-21T16:01:30Z", seconds_to_respond: 45 }),
    offer({ offer_id: "f3", rider_id: "r3", rider_name: null, attempt_no: 3, status: "offered", responded_at: null, seconds_to_respond: null }),
  ],
  events: [
    { at: "2026-10-21T15:40:00Z", event: "scheduled", cycle_no: null, attempt_no: null, offer_id: null, rider_id: null, data: { start_at: "2026-10-21T15:50:00Z", expected_ready_at: "2026-10-21T16:00:00Z" } },
    { at: "2026-10-21T16:00:00Z", event: "offer_created", cycle_no: 1, attempt_no: 1, offer_id: "f1", rider_id: "r1", data: { distance_m: 900, eta_seconds: 200 } },
    { at: "2026-10-21T16:00:12Z", event: "offer_declined", cycle_no: 1, attempt_no: 1, offer_id: "f1", rider_id: "r1", data: { reason: "rider_declined" } },
    { at: "2026-10-21T16:00:13Z", event: "tick_lag", cycle_no: null, attempt_no: null, offer_id: null, rider_id: null, data: { lag_ms: 12000 } },
  ],
};

describe("readDispatchHistory", () => {
  it("shows each rider asked with round, attempt, distance, ETA and the outcome in plain words", () => {
    const history = readDispatchHistory(document);
    expect(history.orderCode).toBe("KK-1001");
    expect(history.stateText).toBe("Waiting for a rider to answer");
    expect(history.roundNo).toBe(1);
    expect(history.offers).toHaveLength(3);
    expect(history.offers[0]).toMatchObject({ riderName: "Ada Bello", roundNo: 1, attemptNo: 1, distanceM: 900, etaSeconds: 200, outcome: "Declined", secondsToRespond: 12 });
    expect(history.offers[1]).toMatchObject({ outcome: "No answer in time", secondsToRespond: 45 });
    expect(history.offers[2]).toMatchObject({ riderName: "A rider", outcome: "Waiting for an answer", secondsToRespond: null });
  });

  it("turns key events into sentences, names the rider, and drops the noise", () => {
    const texts = readDispatchHistory(document).events.map((event) => event.text);
    expect(texts).toEqual([
      "The search was planned to start at 16:50 (food expected ready at 17:00).",
      "Ada Bello was asked (0.9 km away, would reach the store in about 3 min).",
      "Ada Bello declined.",
    ]);
  });

  it("copes with an order that has no dispatch record or history yet", () => {
    const history = readDispatchHistory({ order: { id: "o2", code: "KK-2", status: "placed", delivery_by: "rider", rider_id: null }, dispatch: null, offers: [], events: [] });
    expect(history).toMatchObject({ stateText: null, roundNo: 0, offers: [], events: [], deliveredByStore: false });
    expect(readDispatchHistory({ order: { delivery_by: "vendor" } }).deliveredByStore).toBe(true);
  });

  it("keeps the rider timing for an assigned order", () => {
    const history = readDispatchHistory({
      ...document,
      dispatch: { ...document.dispatch, state: "assigned", assigned_at: "2026-10-21T16:02:00Z", assigned_eta_at: "2026-10-21T16:09:00Z", current_eta_at: "2026-10-21T16:11:00Z", rider_arrived_vendor_at: "2026-10-21T16:10:30Z" },
    });
    expect(history).toMatchObject({ stateText: "A rider has the order", assignedEtaAt: "2026-10-21T16:09:00Z", currentEtaAt: "2026-10-21T16:11:00Z", riderArrivedAt: "2026-10-21T16:10:30Z" });
  });

  it("refuses a document of the wrong shape", () => {
    expect(() => readDispatchHistory({ offers: "nope" })).toThrow(/unexpected shape/);
    expect(() => readDispatchHistory(null)).toThrow(/unexpected shape/);
  });
});

describe("describeOfferOutcome", () => {
  it("covers every offer status in plain words", () => {
    expect(describeOfferOutcome("accepted", null)).toBe("Accepted");
    expect(describeOfferOutcome("revoked", "admin_reassigned")).toBe("Taken off the order by an admin");
    expect(describeOfferOutcome("superseded", "order_assigned")).toBe("Not needed: another rider took the order");
    expect(describeOfferOutcome("superseded", "admin_assigned")).toBe("Replaced when an admin assigned a rider");
    expect(describeOfferOutcome("superseded", "migration_sequential")).toBe("Replaced by a newer offer");
    expect(describeOfferOutcome("cancelled", "rider_unavailable")).toBe("Cancelled: the rider went offline or became busy");
    expect(describeOfferOutcome("cancelled", "vendor_self_delivery")).toBe("Cancelled: the store chose to deliver it");
    expect(describeOfferOutcome("cancelled", null)).toBe("Cancelled");
  });
});

describe("describeDispatchEvent", () => {
  it("explains what happened around the food and the rider", () => {
    expect(describeDispatchEvent("offer_accepted", "Ada", { path: "admin_assign" })).toBe("An admin assigned Ada.");
    expect(describeDispatchEvent("offer_expired", "Ada", {})).toBe("Ada did not answer in time.");
    expect(describeDispatchEvent("needs_attention", "A rider", { reason: "two_cycles_without_accept" })).toBe("Flagged for attention: no rider accepted after two full rounds.");
    expect(describeDispatchEvent("prep_estimate_changed", "A rider", { new: "2026-10-21T16:30:00Z" })).toBe("The store changed when the food will be ready to 17:30.");
    expect(describeDispatchEvent("eta_increased", "Ada", { increase_seconds: 420 })).toBe("The rider is running about 7 min later than first expected.");
    expect(describeDispatchEvent("rider_at_vendor", "Ada", { wait_seconds: 300 })).toBe("Ada arrived at the store; the food had been ready for 5 min.");
    expect(describeDispatchEvent("rider_at_vendor", "Ada", { wait_seconds: -180 })).toBe("Ada arrived at the store and waited 3 min for the food.");
    expect(describeDispatchEvent("rider_at_vendor", "Ada", { wait_seconds: 10 })).toBe("Ada arrived at the store just as the food was ready.");
    expect(describeDispatchEvent("ready_early", "A rider", { early_seconds: 240 })).toBe("The food was ready 4 min early.");
    expect(describeDispatchEvent("start_recomputed", "A rider", { reason: "admin_redispatch" })).toBe("An admin pulled the search forward to now.");
    expect(describeDispatchEvent("some_future_event", "A rider", {})).toBe("some future event");
    expect(describeDispatchEvent("tick_lag", "A rider", {})).toBeNull();
  });

  it("never uses the engine's jargon", () => {
    const events = ["scheduled", "cycle_started", "ring_expanded", "no_candidates", "tick_error", "push_failed", "accept_conflict", "stale_accept_rejected"];
    const words = events.map((event) => describeDispatchEvent(event, "Ada", {})).join(" ");
    expect(words).not.toMatch(/\bH3\b|\bring\b|\bcycle\b|\bKNN\b|\bTTL\b/i);
  });
});

describe("formatResponseTime", () => {
  it("reads like a stopwatch", () => {
    expect(formatResponseTime(null)).toBeNull();
    expect(formatResponseTime(12.4)).toBe("12 s");
    expect(formatResponseTime(65)).toBe("1 min 5 s");
    expect(formatResponseTime(120)).toBe("2 min");
  });
});
