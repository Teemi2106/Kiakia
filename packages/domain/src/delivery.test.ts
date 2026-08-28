import { describe, expect, it } from "vitest";
import {
  computeDeliveryFee,
  computePlacementFees,
  computeRiderFee,
  computeServiceFee,
} from "./delivery.js";
import { koboOf } from "./money.js";

describe("computeServiceFee", () => {
  it("is 2% of subtotal", () => {
    expect(computeServiceFee(koboOf(1_000_000))).toBe(20_000);
  });

  it("rounds half-up like applyBps", () => {
    expect(computeServiceFee(koboOf(101))).toBe(2); // 2.02 -> 2
  });
});

describe("computeDeliveryFee", () => {
  const base = {
    subtotalKobo: koboOf(1_000_000),
    baseDeliveryFeeKobo: koboOf(50_000),
    perKmFeeKobo: koboOf(15_000),
    freeAboveKobo: null,
  };

  it("charges base fee only within the first km", () => {
    expect(computeDeliveryFee({ ...base, distanceM: 800 })).toBe(50_000 + 15_000);
  });

  it("rounds distance up to the next whole km", () => {
    expect(computeDeliveryFee({ ...base, distanceM: 2_100 })).toBe(50_000 + 15_000 * 3);
  });

  it("charges nothing at zero distance beyond the base fee", () => {
    expect(computeDeliveryFee({ ...base, distanceM: 0 })).toBe(50_000);
  });

  it("waives delivery entirely once subtotal reaches the free-above threshold", () => {
    expect(
      computeDeliveryFee({ ...base, freeAboveKobo: koboOf(1_000_000), distanceM: 5_000 }),
    ).toBe(0);
  });

  it("does not waive delivery below the threshold", () => {
    expect(
      computeDeliveryFee({ ...base, freeAboveKobo: koboOf(2_000_000), distanceM: 5_000 }),
    ).toBeGreaterThan(0);
  });

  it("rejects a negative distance", () => {
    expect(() => computeDeliveryFee({ ...base, distanceM: -1 })).toThrow(RangeError);
  });
});

describe("computeRiderFee", () => {
  const base = {
    riderBaseFeeKobo: koboOf(50_000),
    riderPerKmFeeKobo: koboOf(15_000),
  };

  it("charges base fee only when both legs sum under 1km", () => {
    expect(computeRiderFee({ ...base, pickupDistanceM: 400, dropoffDistanceM: 400 })).toBe(
      50_000 + 15_000,
    );
  });

  it("sums the pickup and dropoff legs before rounding up to the next km", () => {
    // 900m pickup + 1_300m dropoff = 2_200m -> ceil to 3km.
    expect(computeRiderFee({ ...base, pickupDistanceM: 900, dropoffDistanceM: 1_300 })).toBe(
      50_000 + 15_000 * 3,
    );
  });

  it("still pays the rider when dropoff distance is 0 (e.g. a waived-fee order)", () => {
    // Unlike computeDeliveryFee, there is no free-above waiver here — the
    // rider is paid for the pickup leg regardless of the customer's fee.
    expect(computeRiderFee({ ...base, pickupDistanceM: 2_000, dropoffDistanceM: 0 })).toBe(
      50_000 + 15_000 * 2,
    );
  });

  it("rejects a negative pickup distance", () => {
    expect(() =>
      computeRiderFee({ ...base, pickupDistanceM: -1, dropoffDistanceM: 0 }),
    ).toThrow(RangeError);
  });

  it("rejects a negative dropoff distance", () => {
    expect(() =>
      computeRiderFee({ ...base, pickupDistanceM: 0, dropoffDistanceM: -1 }),
    ).toThrow(RangeError);
  });
});

describe("computePlacementFees", () => {
  it("returns both fees together", () => {
    const fees = computePlacementFees({
      subtotalKobo: koboOf(1_000_000),
      baseDeliveryFeeKobo: koboOf(50_000),
      perKmFeeKobo: koboOf(15_000),
      freeAboveKobo: null,
      distanceM: 1_500,
    });

    expect(fees.serviceFeeKobo).toBe(20_000);
    expect(fees.deliveryFeeKobo).toBe(50_000 + 15_000 * 2);
  });
});
