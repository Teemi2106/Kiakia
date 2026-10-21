import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface MarketingPreferences {
  readonly marketingEmail: boolean;
  readonly marketingSms: boolean;
}

/** The signed-in person's promotion choices; both off until they say otherwise (no row yet means off). */
export async function loadMarketingPreferences(userId: string): Promise<MarketingPreferences> {
  const supabase = await createClient();
  const { data } = await supabase.from("message_preferences").select("marketing_email, marketing_sms").eq("user_id", userId).maybeSingle();
  return { marketingEmail: data?.marketing_email ?? false, marketingSms: data?.marketing_sms ?? false };
}
