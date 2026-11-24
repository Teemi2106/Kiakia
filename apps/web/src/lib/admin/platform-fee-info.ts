import { applyBps, koboOf } from "@kiakia/domain";
import type { PlatformFeeKey } from "@/lib/validation/admin";

/**
 * Plain-language description of each admin-set platform fee, shared by the
 * Settings page and its tests. No server-only imports so it stays unit-testable.
 */
export interface PlatformFeeInfo {
  readonly key: PlatformFeeKey;
  readonly title: string;
  readonly whoPays: string;
  readonly what: string;
  /** When a change starts to apply, in words. */
  readonly appliesTo: string;
  /** Largest value the database accepts, in basis points. */
  readonly maxBps: number;
}

export const PLATFORM_FEES: readonly PlatformFeeInfo[] = [
  {
    key: "service_fee_bps",
    title: "Customer service fee",
    whoPays: "The customer pays this, on top of the food and delivery.",
    what: "A percentage of the food subtotal that KiaKia keeps from each order.",
    appliesTo: "Orders placed after you save. Orders already placed keep the fee they were placed with.",
    maxBps: 2000,
  },
  {
    key: "default_vendor_commission_bps",
    title: "Commission for new vendors",
    whoPays: "The vendor pays this, out of their food sales.",
    what: "The commission a store starts with when it joins. You can still set a different commission for any one store.",
    appliesTo: "Stores that join after you save. Stores already on KiaKia keep their current commission.",
    maxBps: 5000,
  },
  {
    key: "cashback_bps",
    title: "KiaKia Coins cashback",
    whoPays: "Customers earn the coins after their order is delivered.",
    what: "The reward rate on the food subtotal after discounts, up to 0.5%. Rewards are capped at ₦500 (5,000 coins) per order. Ten KiaKia Coins are worth ₦1.",
    appliesTo: "Orders placed after you save. Each order keeps the rate that was active when it was placed.",
    maxBps: 50,
  },
];

const EXAMPLE_SUBTOTAL_KOBO = 500_000;

/** The worked example shown beside the current value, e.g. "On a ₦5,000 order the service fee is ₦100". */
export function platformFeeExample(key: PlatformFeeKey, bps: number, format: (kobo: number) => string): string {
  const amount = applyBps(koboOf(EXAMPLE_SUBTOTAL_KOBO), bps);
  const order = format(EXAMPLE_SUBTOTAL_KOBO).replace(/\.00$/, "");
  const fee = format(amount).replace(/\.00$/, "");
  if (key === "service_fee_bps") return `On a ${order} order the service fee is ${fee}.`;
  if (key === "cashback_bps") {
    const coins = Math.min(Math.floor(amount / 10), 5_000);
    const reward = format(koboOf(coins * 10)).replace(/\.00$/, "");
    return `On ${order} of delivered food orders customers earn up to ${coins} coins (${reward} value), capped at ₦500 per order.`;
  }
  return `On ${order} of food sales a new vendor pays ${fee} commission.`;
}
