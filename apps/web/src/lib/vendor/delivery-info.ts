import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { parseDispatchState, type VendorDispatchState } from "./self-delivery";

/**
 * Who delivers each of a store's orders, and (for orders waiting for a rider)
 * what the dispatch is doing, read with the vendor's own session client.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type DeliveryBy = "rider" | "vendor";

export interface OrderDeliveryInfo {
  readonly deliveryBy: DeliveryBy;
  /** Present for a rider-delivery order not yet picked up: waiting for a rider, searching, or a rider on the way. */
  readonly dispatch: VendorDispatchState | null;
}

/** Orders whose dispatch state is worth asking for: not picked up yet (a rider may already be assigned, even before the food is ready). */
const NEEDS_DISPATCH_STATE = new Set(["accepted", "preparing", "ready_for_pickup", "rider_assigned"]);

export async function loadDeliveryInfo(
  supabase: Supabase,
  orders: readonly { id: string; status: string }[],
): Promise<Map<string, OrderDeliveryInfo>> {
  const result = new Map<string, OrderDeliveryInfo>();
  if (orders.length === 0) return result;

  const { data } = await supabase.from("orders").select("id, delivery_by").in("id", orders.map((order) => order.id));
  const deliveryBy = new Map((data ?? []).map((row) => [row.id, row.delivery_by]));

  await Promise.all(
    orders.map(async (order) => {
      const by = deliveryBy.get(order.id) ?? "rider";
      let dispatch: VendorDispatchState | null = null;
      if (by === "rider" && NEEDS_DISPATCH_STATE.has(order.status)) {
        const state = await supabase.rpc("vendor_dispatch_state", { p_order_id: order.id });
        dispatch = state.error ? null : parseDispatchState(state.data);
      }
      result.set(order.id, { deliveryBy: by, dispatch });
    }),
  );
  return result;
}
