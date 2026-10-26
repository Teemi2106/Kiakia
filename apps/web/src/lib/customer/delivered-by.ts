import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * True when the store itself is delivering this order (orders.delivery_by =
 * 'vendor'), so the customer pages show "Delivered by {store}" instead of a
 * rider card. Read with the customer's own session; RLS already limits it to
 * their order.
 */
export async function isDeliveredByStore(supabase: Supabase, orderId: string): Promise<boolean> {
  const { data } = await supabase.from("orders").select("delivery_by").eq("id", orderId).maybeSingle();
  return data?.delivery_by === "vendor";
}
