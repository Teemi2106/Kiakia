import { describe, expect, it } from "vitest";
import {
  canAdjustPrep,
  extendedReadyMinutes,
  parsePrepEstimateResult,
  parseReadyInMinutes,
  prepEstimateErrorMessage,
  prepEstimateMessage,
  readyInMinutesSchema,
} from "./prep-estimate";

const NOW = Date.parse("2026-10-25T15:00:00Z");

describe("canAdjustPrep", () => {
  it("is for accepted and preparing rider-delivery orders only", () => {
    expect(canAdjustPrep({ status: "accepted", deliveryBy: "rider" })).toBe(true);
    expect(canAdjustPrep({ status: "preparing" })).toBe(true);
    for (const status of ["placed", "ready_for_pickup", "rider_assigned", "picked_up", "delivered"]) {
      expect(canAdjustPrep({ status, deliveryBy: "rider" })).toBe(false);
    }
    expect(canAdjustPrep({ status: "preparing", deliveryBy: "vendor" })).toBe(false);
  });
});

describe("readyInMinutesSchema", () => {
  it("accepts 1 to 180 whole minutes", () => {
    for (const minutes of [1, 20, 180]) expect(readyInMinutesSchema.safeParse(minutes).success).toBe(true);
    for (const minutes of [0, -5, 181, 2.5, Number.NaN]) expect(readyInMinutesSchema.safeParse(minutes).success).toBe(false);
  });
});

describe("parseReadyInMinutes", () => {
  it("reads a typed whole number in range", () => {
    expect(parseReadyInMinutes(" 25 ")).toEqual({ ok: true, minutes: 25 });
    expect(parseReadyInMinutes("180")).toEqual({ ok: true, minutes: 180 });
  });
  it("explains what is wrong", () => {
    expect(parseReadyInMinutes("")).toMatchObject({ ok: false });
    expect(parseReadyInMinutes("abc")).toMatchObject({ ok: false });
    expect(parseReadyInMinutes("2.5")).toMatchObject({ ok: false });
    expect(parseReadyInMinutes("0")).toEqual({ ok: false, error: "Enter at least 1 minute." });
    expect(parseReadyInMinutes("181")).toEqual({ ok: false, error: "Enter 180 minutes or fewer." });
  });
});

describe("extendedReadyMinutes", () => {
  it("adds the extra to the time still left", () => {
    expect(extendedReadyMinutes("2026-10-25T15:12:00Z", 10, NOW)).toBe(22);
  });
  it("counts an estimate that has already passed as zero left", () => {
    expect(extendedReadyMinutes("2026-10-25T14:50:00Z", 5, NOW)).toBe(5);
  });
  it("never goes past 180 minutes", () => {
    expect(extendedReadyMinutes("2026-10-25T17:55:00Z", 15, NOW)).toBe(180);
  });
  it("is null without a current estimate", () => {
    expect(extendedReadyMinutes(null, 5, NOW)).toBeNull();
  });
});

describe("result and error wording", () => {
  it("reads the RPC result and reports the new time in Lagos time", () => {
    const result = parsePrepEstimateResult({ order_id: "x", expected_ready_at: "2026-10-25T15:30:00Z", start_at: null, rider_notified: false });
    expect(result).toEqual({ expectedReadyAt: "2026-10-25T15:30:00Z", riderNotified: false });
    expect(prepEstimateMessage(result)).toBe("Got it. Food expected ready at 16:30.");
    expect(prepEstimateMessage({ ...result, riderNotified: true })).toBe("Got it. Food expected ready at 16:30. Your rider has been told.");
    expect(parsePrepEstimateResult(null)).toEqual({ expectedReadyAt: null, riderNotified: false });
    expect(prepEstimateMessage(parsePrepEstimateResult(null))).toBe("Got it. The ready time is updated.");
  });
  it("maps the database's refusals to friendly wording", () => {
    expect(prepEstimateErrorMessage({ code: "P0429", message: "vendor_update_prep_estimate: too many changes for this order" })).toMatch(/several times/);
    expect(prepEstimateErrorMessage({ code: "23514", message: "vendor_update_prep_estimate: ready_in_minutes must be between 1 and 180" })).toBe("Enter a time between 1 and 180 minutes.");
    expect(prepEstimateErrorMessage({ code: "23514", message: "vendor_update_prep_estimate: the order is not being prepared" })).toBe("the order is not being prepared");
    expect(prepEstimateErrorMessage({ code: "42501", message: "x" })).toBe("You don't have permission to do that for this order.");
    expect(prepEstimateErrorMessage({ code: "XX000", message: "relation boom" })).toBe("Something went wrong. Please try again.");
  });
});
