import { describe, expect, it } from "vitest";
import { MAX_MENU_PRICE_KOBO, parseMenuPriceKobo } from "./limits";

describe("parseMenuPriceKobo", () => {
  it("converts whole-kobo Naira amounts exactly", () => {
    expect(parseMenuPriceKobo("2500.50")).toBe(250_050);
    expect(parseMenuPriceKobo("0.01")).toBe(1);
    expect(parseMenuPriceKobo(1234.56)).toBe(123_456);
  });

  it("accepts the ceiling and rejects one kobo above it", () => {
    expect(parseMenuPriceKobo(MAX_MENU_PRICE_KOBO / 100)).toBe(MAX_MENU_PRICE_KOBO);
    expect(parseMenuPriceKobo(MAX_MENU_PRICE_KOBO / 100 + 0.01)).toBeNull();
  });

  it("rejects amounts that are not a whole number of kobo", () => {
    expect(parseMenuPriceKobo("0.004")).toBeNull();
    expect(parseMenuPriceKobo("12.345")).toBeNull();
  });

  it("rejects zero, negative, blank and non-numeric input", () => {
    for (const bad of ["0", "-5", "", "  ", "abc", "NaN", "Infinity", null, undefined, {}]) {
      expect(parseMenuPriceKobo(bad)).toBeNull();
    }
  });

  it("rejects values too large to hold as a safe integer", () => {
    expect(parseMenuPriceKobo("1e20")).toBeNull();
    expect(parseMenuPriceKobo("10000000000000")).toBeNull();
  });
});
