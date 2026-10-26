import { describe, expect, it } from "vitest";
import {
  bannerQuestion,
  codeFailure,
  deliveryErrorMessage,
  expandLabel,
  expandResultMessage,
  formatCountdown,
  nextSelfDeliveryStep,
  parseDispatchState,
  parseExpandResult,
  retrySecondsFrom,
} from "./self-delivery";

describe("parseDispatchState", () => {
  it("reads the RPC object", () => {
    expect(
      parseDispatchState({ state: "no_rider_nearby", can_expand: true, expand_available_in_seconds: null, riders_in_range: 0, store_radius_m: 20_000, radius_m: 5000, base_radius_m: 5000, expansions_used: 1 }, 1_000),
    ).toEqual({
      state: "no_rider_nearby",
      canExpand: true,
      expandAvailableInSeconds: 0,
      ridersInRange: 0,
      storeRadiusM: 20_000,
      radiusM: 5000,
      baseRadiusM: 5000,
      expansionsUsed: 1,
      engineState: null,
      expectedReadyAt: null,
      startAt: null,
      assignedEtaAt: null,
      asOfMs: 1_000,
    });
  });
  it("reads the sequential-dispatch timing fields (0102) and ignores junk", () => {
    expect(
      parseDispatchState(
        { state: "offers_pending", dispatch_state: "scheduled", expected_ready_at: "2026-10-25T15:30:00Z", start_at: "2026-10-25T15:12:00Z", assigned_eta_at: "nope", attempts_made: 0 },
        5,
      ),
    ).toMatchObject({ engineState: "scheduled", expectedReadyAt: "2026-10-25T15:30:00Z", startAt: "2026-10-25T15:12:00Z", assignedEtaAt: null, asOfMs: 5 });
    expect(parseDispatchState({ state: "offers_pending", dispatch_state: "mystery" })?.engineState).toBeNull();
  });
  it("accepts a one-row array, rounds the countdown up, and rejects unknown states", () => {
    expect(parseDispatchState([{ state: "offers_pending", expand_available_in_seconds: 29.2 }])).toMatchObject({ state: "offers_pending", canExpand: false, expandAvailableInSeconds: 30 });
    expect(parseDispatchState({ state: "not_applicable" })?.state).toBe("not_applicable");
    expect(parseDispatchState({ state: "mystery" })).toBeNull();
    expect(parseDispatchState(null)).toBeNull();
  });
});

describe("copy", () => {
  it("names the store's own distance in the question and on the button", () => {
    const can = { canExpand: true, expandAvailableInSeconds: 0 };
    expect(bannerQuestion({ ...can, storeRadiusM: 20_000 })).toBe("Do you want us to look for riders further away (up to 20 km), or will you deliver this order yourself?");
    expect(bannerQuestion({ ...can, storeRadiusM: null })).toBe("Do you want us to look for riders further away, or will you deliver this order yourself?");
    // Nothing wider to search (no first-round distance, or already at the store's distance): wait or deliver.
    expect(bannerQuestion({ canExpand: false, expandAvailableInSeconds: 0, storeRadiusM: 20_000 })).toBe("Do you want to keep waiting for a rider, or will you deliver this order yourself?");
    // While the countdown runs the option still exists.
    expect(bannerQuestion({ canExpand: false, expandAvailableInSeconds: 30, storeRadiusM: 20_000 })).toContain("further away");
    expect(expandLabel({ storeRadiusM: 20_000 })).toBe("Look further away (up to 20 km)");
    expect(expandLabel({ storeRadiusM: null })).toBe("Look further away");
  });
  it("counts down as m:ss", () => {
    expect(formatCountdown(45)).toBe("0:45");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(0)).toBe("0:00");
  });
  it("reports the wider search in words", () => {
    expect(expandResultMessage({ offered: 3 })).toBe("Sent to 3 riders.");
    expect(expandResultMessage({ offered: 1 })).toBe("Sent to 1 rider.");
    expect(expandResultMessage({ offered: 0 })).toBe("Still no riders; you can deliver it yourself.");
    expect(parseExpandResult({ offers_created: 2, riders_in_range: null })).toEqual({ offered: 2, ridersInRange: null });
    expect(parseExpandResult(null)).toEqual({ offered: 0, ridersInRange: null });
  });
});

describe("error mapping", () => {
  it("passes the database's own plain message through, fixed wording for the rest", () => {
    expect(deliveryErrorMessage({ code: "23514", message: "vendor_expand_rider_search: riders are already being searched up to your full delivery radius" })).toBe("riders are already being searched up to your full delivery radius");
    expect(deliveryErrorMessage({ code: "P0429", message: "rate_limited: try again in 40 seconds" })).toBe("Please wait 40 seconds before searching again.");
    expect(deliveryErrorMessage({ code: "P0429", message: "rate_limited: the rider search for this order can only be widened 3 times" })).toBe("the rider search for this order can only be widened 3 times");
    expect(deliveryErrorMessage({ code: "P0429", message: "vendor_update_prep_estimate: too many changes for this order" })).toBe("too many changes for this order");
    expect(deliveryErrorMessage({ code: "42501", message: "x" })).toBe("You don't have permission to do that for this order.");
    expect(deliveryErrorMessage({ code: "P0002", message: "x" })).toBe("That order no longer exists.");
    expect(deliveryErrorMessage({ code: "XX000", message: 'relation "orders" broke' })).toBe("Something went wrong. Please try again.");
  });
  it("finds a retry time in a rate-limit message", () => {
    expect(retrySecondsFrom("rate_limited: try again in 40 seconds")).toBe(40);
    expect(retrySecondsFrom("nothing here")).toBeNull();
  });
});

describe("codeFailure", () => {
  it("says the code is wrong and warns about the lock", () => {
    const failure = codeFailure({ data: { code_matched: false } });
    expect(failure.locked).toBe(false);
    expect(failure.message).toContain("That code is not right");
    expect(failure.message).toContain("After 5 wrong tries");
  });
  it("locks with a support message", () => {
    const failure = codeFailure({ error: { message: "verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order x" } });
    expect(failure.locked).toBe(true);
    expect(failure.message).toMatch(/contact KiaKia support/);
  });
});

describe("self-delivery steps", () => {
  it("offers one button at a time, strictly in order, and then the code", () => {
    expect(nextSelfDeliveryStep("ready_for_pickup")).toEqual({ to: "picked_up", label: "I've picked it up" });
    expect(nextSelfDeliveryStep("picked_up")).toEqual({ to: "in_transit", label: "I'm on my way" });
    expect(nextSelfDeliveryStep("in_transit")).toEqual({ to: "arrived", label: "I've arrived" });
    expect(nextSelfDeliveryStep("arrived")).toBeNull();
    expect(nextSelfDeliveryStep("preparing")).toBeNull();
    expect(nextSelfDeliveryStep("delivered")).toBeNull();
  });
});
