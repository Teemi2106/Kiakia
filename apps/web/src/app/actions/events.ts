"use server";

import { getOptionalSession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { type CustomerEventInput, customerEventSchema } from "@/lib/validation/events";

export type LogCustomerEventResult = { ok: boolean };

/**
 * Best-effort behavioural logging for the home recommender (view_vendor,
 * view_item, search, recommendation_click). Analytics must never break or
 * slow the page that fires it, so this NEVER throws and never redirects:
 * a logged-out caller, an invalid payload, or an RPC failure all simply
 * resolve `{ ok: false }`.
 *
 * Like every Server Function it is reachable by direct POST, so it checks
 * the session itself (getOptionalSession, not verifySession - no redirect
 * for a best-effort call). It runs on the user-scoped client, and the
 * log_customer_event() RPC always records auth.uid(); this action does not
 * accept - and never forwards - a customer id. The RPC independently
 * rejects cart_* types, inactive vendors, dedupes and rate-limits.
 */
export async function logCustomerEventAction(input: CustomerEventInput): Promise<LogCustomerEventResult> {
  try {
    const parsed = customerEventSchema.safeParse(input);
    if (!parsed.success) return { ok: false };

    const session = await getOptionalSession();
    if (!session) return { ok: false };

    const supabase = await createClient();
    const { error } = await supabase.rpc("log_customer_event", {
      p_event_type: parsed.data.eventType,
      p_vendor_id: parsed.data.vendorId ?? null,
      p_menu_item_id: parsed.data.menuItemId ?? null,
      p_search_query: parsed.data.searchQuery ?? null,
    });

    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
