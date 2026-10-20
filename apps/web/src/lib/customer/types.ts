import type { CartLineItem } from "@/lib/cart";

/** The open cart's identity; its lines live beside it in the store. */
export interface CartMeta {
  readonly id: string;
  readonly vendorId: string;
  readonly vendorName: string;
}

/**
 * What the (customer) layout reads once on the server and the store is
 * seeded from. Built from customer_bootstrap() by lib/customer/bootstrap.ts.
 */
export interface CustomerSnapshot {
  readonly userId: string;
  readonly cart: CartMeta | null;
  readonly lines: readonly CartLineItem[];
  readonly unreadCount: number;
  /** The default address's label, or its first line when it has none. */
  readonly addressLabel: string | null;
}
