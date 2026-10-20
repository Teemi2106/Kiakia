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

describe("computeServiceFee with a live rate", () => {
  it("uses the supplied bps instead of the seed default", () => {
    expect(computeServiceFee(koboOf(500_000), 500)).toBe(25_000);
    expect(computeServiceFee(koboOf(500_000), 0)).toBe(0);
  });
});

describe("computeDeliveryFee", () => {
  const base = {
    subtotalKobo: koboOf(1_000_000),
    baseDeliveryFeeKobo: koboOf(50_000),
    perKmFeeKobo: koboOf(15_000),
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

  it("charges the full fee regardless of how large the subtotal is (no free-delivery waiver)", () => {
    // See this module's file header: the free-above-threshold waiver was
    // removed (0062_remove_free_delivery_threshold.sql) because it let the
    // customer's fee drop to zero while the rider was still paid in full,
    // with nothing tying the two together.
    expect(computeDeliveryFee({ ...base, subtotalKobo: koboOf(50_000_000), distanceM: 5_000 })).toBe(
      50_000 + 15_000 * 5,
    );
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

  it("still pays the rider when dropoff distance is 0", () => {
    // computeRiderFee has never had a free-above waiver (unlike
    // computeDeliveryFee, which used to) — the rider is paid for the
    // pickup leg regardless of what the customer's own fee happens to be.
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
      distanceM: 1_500,
    });

    expect(fees.serviceFeeKobo).toBe(20_000);
    expect(fees.deliveryFeeKobo).toBe(50_000 + 15_000 * 2);
  });
});
