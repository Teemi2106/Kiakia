import { describe, expect, it } from "vitest";
import {
  dispatchInputValue,
  dispatchPreview,
  dispatchPreviewFor,
  dispatchRangeError,
  DISPATCH_SETTING_INFO,
  formatDispatchValue,
  formatKm,
  formatSeconds,
  parseDispatchInput,
} from "./dispatch-settings-info";

const ctx = { radiusM: 5000, maxRiders: 5, widenAfterSeconds: 120, notifyVendorAfterSeconds: 45 };

describe("units", () => {
  it("formats km and seconds in words", () => {
    expect(formatKm(5000)).toBe("5 km");
    expect(formatKm(8500)).toBe("8.5 km");
    expect(formatSeconds(0)).toBe("never");
    expect(formatSeconds(90)).toBe("1.5 minutes");
    expect(formatSeconds(60)).toBe("1 minute");
    expect(formatSeconds(45)).toBe("45 seconds");
    expect(formatDispatchValue("dispatch_max_riders", 1)).toBe("1 rider");
    expect(formatDispatchValue("dispatch_radius_m", 0)).toBe("No limit");
  });
  it("converts what is typed to the stored unit and back", () => {
    expect(parseDispatchInput("dispatch_radius_m", "7.5")).toBe(7500);
    expect(parseDispatchInput("dispatch_max_riders", "5")).toBe(5);
    expect(parseDispatchInput("dispatch_max_riders", "5.5")).toBeNull();
    expect(parseDispatchInput("dispatch_widen_after_seconds", "2")).toBe(120);
    expect(parseDispatchInput("dispatch_widen_after_seconds", "0")).toBe(0);
    expect(parseDispatchInput("dispatch_radius_m", "abc")).toBeNull();
    expect(dispatchInputValue("dispatch_radius_m", 7500)).toBe("7.5");
    expect(dispatchInputValue("dispatch_widen_after_seconds", 90)).toBe("1.5");
  });
});

describe("range rules", () => {
  it("allows 0 where it means something (no limit, never)", () => {
    expect(dispatchRangeError("dispatch_widen_after_seconds", 0)).toBeNull();
    expect(dispatchRangeError("dispatch_radius_m", 0)).toBeNull();
    expect(dispatchRangeError("dispatch_radius_m", 500)).toMatch(/0 or at least 1 km/);
    expect(dispatchRangeError("dispatch_max_riders", 51)).toMatch(/no more than 50 riders/);
    expect(dispatchRangeError("dispatch_location_max_age_seconds", 30)).toMatch(/at least 1 minute/);
  });
  it("has no global widened distance any more", () => {
    expect(Object.keys(DISPATCH_SETTING_INFO)).not.toContain("dispatch_widened_radius_m");
  });
});

describe("preview", () => {
  it("shows the incident example for the distance", () => {
    expect(dispatchPreview("dispatch_radius_m", 5000, ctx)).toContain("A rider 8.5 km away cannot be offered");
    expect(dispatchPreview("dispatch_radius_m", 9000, ctx)).toContain("A rider 8.5 km away can be offered");
    expect(dispatchPreview("dispatch_radius_m", 0, ctx)).toMatch(/no distance limit/);
  });
  it("explains never-widen", () => {
    expect(dispatchPreview("dispatch_widen_after_seconds", 0, ctx)).toMatch(/never widen/);
    expect(dispatchPreview("dispatch_widen_after_seconds", 120, ctx)).toContain("as far as the store's own delivery distance");
  });
  it("gives the problem instead of a preview for bad input, and an 'If you save' line for good input", () => {
    const info = DISPATCH_SETTING_INFO.dispatch_radius_m;
    expect(dispatchPreviewFor(info, "0.5", ctx)).toMatchObject({ problem: true });
    expect(dispatchPreviewFor(info, "x", ctx)).toMatchObject({ problem: true });
    const good = dispatchPreviewFor(info, "12", ctx);
    expect(good.problem).toBe(false);
    expect(good.text).toMatch(/^If you save: /);
  });
});
