import { describe, expect, it } from "vitest";
import {
  DISPATCH_DEFAULTS,
  DISPATCH_SETTING_GROUPS,
  DISPATCH_SETTING_INFO,
  DISPATCH_SETTING_KEYS,
  DISPATCH_SETTINGS,
  DISPATCH_VALUE_FIELD,
  dispatchInputValue,
  dispatchPreview,
  dispatchPreviewFor,
  dispatchRangeError,
  dispatchRingOrderError,
  formatDispatchValue,
  formatKm,
  formatSeconds,
  parseDispatchInput,
} from "./dispatch-settings-info";

const ctx = { ...DISPATCH_DEFAULTS, radiusM: 5000, maxRiders: 5, widenAfterSeconds: 120 };

describe("the setting list", () => {
  it("covers every key once, each in a known group, and the field map is complete", () => {
    expect(DISPATCH_SETTINGS.map((info) => info.key).sort()).toEqual([...DISPATCH_SETTING_KEYS].sort());
    const groups = DISPATCH_SETTING_GROUPS.map((group) => group.id);
    expect(DISPATCH_SETTINGS.every((info) => groups.includes(info.group))).toBe(true);
    expect(new Set(Object.values(DISPATCH_VALUE_FIELD)).size).toBe(DISPATCH_SETTING_KEYS.length);
    expect(Object.keys(DISPATCH_DEFAULTS).sort()).toEqual(Object.values(DISPATCH_VALUE_FIELD).sort());
  });

  it("matches the shipped bounds (D10) and keeps every default inside them", () => {
    const bounds = Object.fromEntries(DISPATCH_SETTINGS.map((info) => [info.key, [info.min, info.max]]));
    expect(bounds).toMatchObject({
      dispatch_offer_timeout_seconds: [15, 120],
      dispatch_max_riders: [1, 50],
      dispatch_radius_m: [1000, 50_000],
      dispatch_h3_resolution: [7, 9],
      dispatch_h3_initial_ring: [0, 10],
      dispatch_h3_max_ring: [1, 30],
      dispatch_secure_buffer_seconds: [45, 900],
      dispatch_default_travel_seconds: [60, 3600],
      dispatch_default_speed_kmh: [5, 60],
      dispatch_road_factor_pct: [100, 250],
      dispatch_min_history_samples: [5, 1000],
      dispatch_vendor_arrival_radius_m: [30, 500],
    });
    for (const info of DISPATCH_SETTINGS) {
      expect(dispatchRangeError(info.key, DISPATCH_DEFAULTS[DISPATCH_VALUE_FIELD[info.key]])).toBeNull();
    }
  });

  it("groups the settings the way the page shows them", () => {
    const byGroup = (id: string) => DISPATCH_SETTINGS.filter((info) => info.group === id).map((info) => info.title);
    expect(byGroup("offers")).toEqual(["Offer time", "Riders asked one at a time per round"]);
    expect(byGroup("search-area")).toEqual(["First search distance", "Search further after", "Search area size", "First search: nearby blocks", "Furthest search: nearby blocks"]);
    expect(byGroup("timing")).toHaveLength(6);
    expect(byGroup("location")).toEqual(["Rider location must be newer than"]);
    expect(byGroup("store-alerts")).toEqual(["Tell the store no rider is near after"]);
  });

  it("keeps the engine's jargon out of every word an admin reads", () => {
    const words = DISPATCH_SETTINGS.flatMap((info) => [info.title, info.what, info.inputLabel, dispatchPreview(info.key, info.min, ctx)]).join(" ");
    expect(words).not.toMatch(/\bH3\b|\bring\b|\brings\b|\bcycle\b|\bKNN\b|\bTTL\b/i);
  });
});

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
    expect(formatDispatchValue("dispatch_notify_vendor_after_seconds", 0)).toBe("Straight away");
  });

  it("formats the new settings in the unit an admin thinks in", () => {
    expect(formatDispatchValue("dispatch_offer_timeout_seconds", 45)).toBe("45 seconds");
    expect(formatDispatchValue("dispatch_default_travel_seconds", 600)).toBe("10 minutes");
    expect(formatDispatchValue("dispatch_secure_buffer_seconds", 150)).toBe("2.5 minutes");
    expect(formatDispatchValue("dispatch_default_speed_kmh", 18)).toBe("18 km/h");
    expect(formatDispatchValue("dispatch_road_factor_pct", 135)).toBe("135%");
    expect(formatDispatchValue("dispatch_min_history_samples", 20)).toBe("20 deliveries");
    expect(formatDispatchValue("dispatch_vendor_arrival_radius_m", 100)).toBe("100 m");
    expect(formatDispatchValue("dispatch_h3_initial_ring", 1)).toBe("1 block");
    expect(formatDispatchValue("dispatch_h3_max_ring", 8)).toBe("8 blocks");
  });

  it("maps the map grid level to Small, Medium and Large", () => {
    expect(formatDispatchValue("dispatch_h3_resolution", 9)).toBe("Small (level 9)");
    expect(formatDispatchValue("dispatch_h3_resolution", 8)).toBe("Medium (level 8)");
    expect(formatDispatchValue("dispatch_h3_resolution", 7)).toBe("Large (level 7)");
  });

  it("converts what is typed to the stored unit and back", () => {
    expect(parseDispatchInput("dispatch_radius_m", "7.5")).toBe(7500);
    expect(parseDispatchInput("dispatch_max_riders", "5")).toBe(5);
    expect(parseDispatchInput("dispatch_max_riders", "5.5")).toBeNull();
    expect(parseDispatchInput("dispatch_widen_after_seconds", "2")).toBe(120);
    expect(parseDispatchInput("dispatch_widen_after_seconds", "0")).toBe(0);
    expect(parseDispatchInput("dispatch_default_travel_seconds", "10")).toBe(600);
    expect(parseDispatchInput("dispatch_offer_timeout_seconds", "45")).toBe(45);
    expect(parseDispatchInput("dispatch_offer_timeout_seconds", "4.5")).toBeNull();
    expect(parseDispatchInput("dispatch_min_history_samples", "1000")).toBe(1000);
    expect(parseDispatchInput("dispatch_radius_m", "abc")).toBeNull();
    expect(dispatchInputValue("dispatch_radius_m", 7500)).toBe("7.5");
    expect(dispatchInputValue("dispatch_widen_after_seconds", 90)).toBe("1.5");
    expect(dispatchInputValue("dispatch_default_travel_seconds", 600)).toBe("10");
    expect(dispatchInputValue("dispatch_offer_timeout_seconds", 45)).toBe("45");
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

  it("checks the bounds of the new settings in the admin's words", () => {
    expect(dispatchRangeError("dispatch_offer_timeout_seconds", 14)).toMatch(/at least 15 seconds/);
    expect(dispatchRangeError("dispatch_offer_timeout_seconds", 121)).toMatch(/no more than 2 minutes/);
    expect(dispatchRangeError("dispatch_h3_resolution", 6)).toMatch(/Search area size: choose a value that is at least Large \(level 7\) and no more than Small \(level 9\)/);
    expect(dispatchRangeError("dispatch_h3_resolution", 10)).not.toBeNull();
    expect(dispatchRangeError("dispatch_h3_initial_ring", 0)).toBeNull();
    expect(dispatchRangeError("dispatch_h3_initial_ring", 11)).toMatch(/no more than 10 blocks/);
    expect(dispatchRangeError("dispatch_h3_max_ring", 0)).toMatch(/at least 1 block/);
    expect(dispatchRangeError("dispatch_default_speed_kmh", 61)).toMatch(/no more than 60 km\/h/);
    expect(dispatchRangeError("dispatch_road_factor_pct", 99)).toMatch(/at least 100%/);
    expect(dispatchRangeError("dispatch_min_history_samples", 4)).toMatch(/at least 5 deliveries/);
    expect(dispatchRangeError("dispatch_vendor_arrival_radius_m", 501)).toMatch(/no more than 500 m/);
  });

  it("has no global widened distance any more", () => {
    expect(Object.keys(DISPATCH_SETTING_INFO)).not.toContain("dispatch_widened_radius_m");
  });
});

describe("first search cannot be wider than the furthest search", () => {
  it("refuses a first search beyond the furthest one, with a way out", () => {
    const message = dispatchRingOrderError("dispatch_h3_initial_ring", 9, ctx);
    expect(message).toMatch(/can't reach further than the furthest search, which is 8 blocks now/);
    expect(message).toMatch(/Raise the furthest search first, or choose 8 or fewer/);
    expect(dispatchRingOrderError("dispatch_h3_initial_ring", 8, ctx)).toBeNull();
  });

  it("refuses a furthest search below the first one", () => {
    const message = dispatchRingOrderError("dispatch_h3_max_ring", 0 + 1, { ...ctx, initialRing: 3 });
    expect(message).toMatch(/can't be smaller than the first search, which is 3 blocks now/);
    expect(message).toMatch(/choose 3 or more/);
    expect(dispatchRingOrderError("dispatch_h3_max_ring", 3, { ...ctx, initialRing: 3 })).toBeNull();
  });

  it("ignores every other setting", () => {
    expect(dispatchRingOrderError("dispatch_max_riders", 1, { ...ctx, initialRing: 9, maxRing: 1 })).toBeNull();
  });

  it("stops the form (problem) before saving", () => {
    const initial = DISPATCH_SETTING_INFO.dispatch_h3_initial_ring;
    expect(dispatchPreviewFor(initial, "10", ctx)).toMatchObject({ problem: true });
    expect(dispatchPreviewFor(initial, "10", ctx).text).toMatch(/furthest search/);
    expect(dispatchPreviewFor(initial, "2", ctx)).toMatchObject({ problem: false });
  });
});

describe("preview", () => {
  it("shows the incident example for the distance", () => {
    expect(dispatchPreview("dispatch_radius_m", 5000, ctx)).toContain("A rider 8.5 km away cannot be asked");
    expect(dispatchPreview("dispatch_radius_m", 9000, ctx)).toContain("A rider 8.5 km away can be asked");
    expect(dispatchPreview("dispatch_radius_m", 0, ctx)).toMatch(/no distance limit/);
  });
  it("explains never-widen", () => {
    expect(dispatchPreview("dispatch_widen_after_seconds", 0, ctx)).toMatch(/never search further/);
    expect(dispatchPreview("dispatch_widen_after_seconds", 120, ctx)).toContain("as far as the store's own delivery distance");
  });
  it("explains the one-at-a-time rounds in words", () => {
    expect(dispatchPreview("dispatch_offer_timeout_seconds", 45, ctx)).toBe("Each rider has 45 seconds to answer. If they decline, or the time runs out, the next rider is asked straight away.");
    expect(dispatchPreview("dispatch_max_riders", 10, ctx)).toContain("A round asks up to 10 riders, one at a time");
  });
  it("explains the search area in blocks, and what that is in kilometres", () => {
    expect(dispatchPreview("dispatch_h3_resolution", 8, ctx)).toContain("Medium blocks are roughly 0.8 km across");
    expect(dispatchPreview("dispatch_h3_initial_ring", 0, ctx)).toBe("The first search looks only in the store's own block.");
    expect(dispatchPreview("dispatch_h3_initial_ring", 2, ctx)).toContain("2 blocks around it, roughly 1.6 km from the store");
    expect(dispatchPreview("dispatch_h3_max_ring", 8, { ...ctx, h3Resolution: 9 })).toContain("up to 8 blocks around the store (roughly 2.4 km)");
  });
  it("describes the timing settings", () => {
    expect(dispatchPreview("dispatch_default_travel_seconds", 600, ctx)).toContain("needs 10 minutes to reach the store");
    expect(dispatchPreview("dispatch_road_factor_pct", 135, ctx)).toBe("A 1 km straight line on the map counts as 1.35 km of road.");
    expect(dispatchPreview("dispatch_vendor_arrival_radius_m", 100, ctx)).toBe("A rider counts as at the store once they are within 100 m of it.");
  });
  it("gives the problem instead of a preview for bad input, and an 'If you save' line for good input", () => {
    const info = DISPATCH_SETTING_INFO.dispatch_radius_m;
    expect(dispatchPreviewFor(info, "0.5", ctx)).toMatchObject({ problem: true });
    expect(dispatchPreviewFor(info, "x", ctx)).toMatchObject({ problem: true });
    const good = dispatchPreviewFor(info, "12", ctx);
    expect(good.problem).toBe(false);
    expect(good.text).toMatch(/^If you save: /);
  });
  it("asks for a whole number where decimals make no sense", () => {
    expect(dispatchPreviewFor(DISPATCH_SETTING_INFO.dispatch_default_speed_kmh, "18.5", ctx).text).toBe("Enter a whole number, for example 5.");
    expect(dispatchPreviewFor(DISPATCH_SETTING_INFO.dispatch_radius_m, "x", ctx).text).toBe("Enter a plain number, for example 5 or 7.5.");
  });
});
