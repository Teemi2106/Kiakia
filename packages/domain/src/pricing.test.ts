import { describe, expect, it } from "vitest";
import { koboOf } from "./money";
import { computeOrderTotals, computeSettlementSplit } from "./pricing";

describe("computeOrderTotals", () => {
  it("sums the §9 worked example to ₦12,500 exactly", () => {
    const totals = computeOrderTotals({
      subtotalKobo: koboOf(1_000_000),
      deliveryFeeKobo: koboOf(200_000),
      serviceFeeKobo: koboOf(50_000),
      discountKobo: koboOf(0),
    });

    expect(totals.totalKobo).toBe(1_250_000);
  });

  it("applies a discount", () => {
    const totals = computeOrderTotals({
      subtotalKobo: koboOf(1_000_000),
      deliveryFeeKobo: koboOf(200_000),
      serviceFeeKobo: koboOf(50_000),
      discountKobo: koboOf(100_000),
    });

    expect(totals.totalKobo).toBe(1_150_000);
  });

  it("caps a discount that would otherwise exceed the gross total", () => {
    const totals = computeOrderTotals({
      subtotalKobo: koboOf(1_000),
      deliveryFeeKobo: koboOf(0),
      serviceFeeKobo: koboOf(0),
      discountKobo: koboOf(999_999),
    });

    expect(totals.totalKobo).toBe(0);
    expect(totals.discountKobo).toBe(1_000);
  });
});

describe("computeSettlementSplit", () => {
  it("reproduces the §9 worked example exactly", () => {
    const split = computeSettlementSplit(
      koboOf(1_000_000), // ₦10,000 food
      koboOf(200_000), // ₦2,000 delivery
      koboOf(50_000), // ₦500 service fee
      1_500, // 15% commission
    );

    expect(split.vendorKobo).toBe(850_000);
    expect(split.riderKobo).toBe(200_000);
    expect(split.platformKobo).toBe(200_000);

    // The ledger invariant (§9): every kobo charged must be accounted for.
    const total = split.vendorKobo + split.riderKobo + split.platformKobo;
    expect(total).toBe(1_250_000);
  });

  it("gives the vendor the full subtotal at 0% commission", () => {
    const split = computeSettlementSplit(koboOf(500_000), koboOf(0), koboOf(0), 0);
    expect(split.vendorKobo).toBe(500_000);
    expect(split.platformKobo).toBe(0);
  });
});
