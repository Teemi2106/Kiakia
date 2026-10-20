import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the customer is: state and coordinates of their default (or first)
 * saved address. The home page and the recommendations behind it both need
 * this, so it is one `cache()`d read per request rather than one each.
 */
export const getDefaultAddressLocation = cache(async (userId: string) => {
  const supabase = await createClient();
  return supabase
    .from("addresses")
    .select("state, location_lat, location_lng")
    .eq("customer_id", userId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
});
