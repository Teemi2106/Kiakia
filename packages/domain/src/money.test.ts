import { describe, expect, it } from "vitest";
import {
  InvalidMoneyError,
  addKobo,
  applyBps,
  formatNaira,
  koboOf,
  koboToNaira,
  nairaToKobo,
  subtractKobo,
} from "./money";

describe("koboOf", () => {
  it("accepts non-negative integers", () => {
    expect(koboOf(0)).toBe(0);
    expect(koboOf(1_250_000)).toBe(1_250_000);
  });

  it("rejects non-integers", () => {
    expect(() => koboOf(100.5)).toThrow(InvalidMoneyError);
  });

  it("rejects negative amounts", () => {
    expect(() => koboOf(-1)).toThrow(InvalidMoneyError);
  });
});

describe("nairaToKobo / koboToNaira", () => {
  it("round-trips exactly for typical amounts", () => {
    expect(nairaToKobo(12_500)).toBe(1_250_000);
    expect(koboToNaira(koboOf(1_250_000))).toBe(12_500);
  });

  it("rounds sub-kobo naira input to the nearest kobo", () => {
    // 10.005 naira is not exactly representable; must not throw or silently
    // truncate in a way that loses more than half a kobo.
    expect(nairaToKobo(10.005)).toBe(1_001);
  });
});

describe("addKobo / subtractKobo", () => {
  it("sums an arbitrary number of amounts", () => {
    expect(addKobo(koboOf(1_000_000), koboOf(200_000), koboOf(50_000))).toBe(1_250_000);
  });

  it("throws instead of producing a negative result", () => {
    expect(() => subtractKobo(koboOf(100), koboOf(200))).toThrow(InvalidMoneyError);
  });
});

describe("applyBps", () => {
  it("computes 15% commission on a 10,000 naira subtotal", () => {
    // kiakia-system-architecture.md §9 worked example.
    expect(applyBps(koboOf(1_000_000), 1_500)).toBe(150_000);
  });

  it("rounds half-up to the nearest kobo", () => {
    expect(applyBps(koboOf(101), 5_000)).toBe(51); // 50.5 -> 51
  });

  it("rejects an out-of-range rate", () => {
    expect(() => applyBps(koboOf(100), 10_001)).toThrow(InvalidMoneyError);
  });
});

describe("formatNaira", () => {
  it("formats the §9 worked example total", () => {
    expect(formatNaira(koboOf(1_250_000))).toBe("₦12,500.00");
  });

  it("formats zero", () => {
    expect(formatNaira(koboOf(0))).toBe("₦0.00");
  });
});
