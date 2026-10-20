import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { CustomerSnapshot } from "./types";

/**
 * Everything the customer shell needs, in one round trip: the open cart with
 * its lines, the unread notification count and the default address
 * (customer_bootstrap(), 0089). Wrapped in `cache()` so the layout and any
 * page under it that wants the cart share one call per request.
 *
 * Fails soft to an empty shell: a bootstrap hiccup must not take down every
 * customer page, and the cart/count simply read as empty until the next load.
 */
export const getCustomerBootstrap = cache(async (userId: string): Promise<CustomerSnapshot> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("customer_bootstrap");

  const cart = data?.cart;
  const address = data?.default_address;
  return {
    userId,
    cart: cart?.vendor_id
      ? { id: cart.id, vendorId: cart.vendor_id, vendorName: cart.vendor_name ?? "" }
      : null,
    lines: cart?.vendor_id ? cart.items : [],
    unreadCount: data?.unread_notifications ?? 0,
    addressLabel: address ? address.label || address.line1 : null,
  };
});
