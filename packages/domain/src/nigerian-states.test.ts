import { describe, expect, it } from "vitest";
import { NIGERIAN_STATES, normalizeNigerianState, stateLabel } from "./nigerian-states";

describe("NIGERIAN_STATES", () => {
  it("holds the 36 states plus the FCT, without duplicates", () => {
    expect(NIGERIAN_STATES).toHaveLength(37);
    expect(new Set(NIGERIAN_STATES).size).toBe(37);
  });
});

describe("normalizeNigerianState", () => {
  it("returns canonical names for any casing or 'State' suffix", () => {
    expect(normalizeNigerianState("lagos")).toBe("Lagos");
    expect(normalizeNigerianState("  Lagos State ")).toBe("Lagos");
    expect(normalizeNigerianState("AKWA IBOM")).toBe("Akwa Ibom");
  });

  it("maps every spelling of the capital onto FCT", () => {
    for (const raw of ["FCT", "Abuja", "Federal Capital Territory", "Abuja (FCT)"]) {
      expect(normalizeNigerianState(raw)).toBe("FCT");
    }
  });

  it("rejects anything that is not a Nigerian state", () => {
    expect(normalizeNigerianState("Texas")).toBeNull();
    expect(normalizeNigerianState("")).toBeNull();
    expect(normalizeNigerianState(null)).toBeNull();
    expect(normalizeNigerianState(undefined)).toBeNull();
  });

  it("round-trips every listed state", () => {
    for (const state of NIGERIAN_STATES) expect(normalizeNigerianState(state)).toBe(state);
  });
});

describe("stateLabel", () => {
  it("spells out the capital and leaves other states alone", () => {
    expect(stateLabel("FCT")).toBe("FCT (Abuja)");
    expect(stateLabel("Oyo")).toBe("Oyo");
  });
});
