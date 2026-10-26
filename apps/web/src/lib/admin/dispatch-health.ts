import "server-only";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { cache } from "react";
import { readDispatchHealth, type DispatchHealth } from "./dispatch-health-info";

/** One admin_dispatch_health() call per request, shared by the Overview and the dispatch page. Never throws: a failed check is 'unknown'. */
const fetchHealth = cache(async (): Promise<DispatchHealth> => {
  try {
    const { data, error } = await createAdminClient().rpc("admin_dispatch_health");
    if (error) return { state: "unknown" };
    return readDispatchHealth(data);
  } catch {
    return { state: "unknown" };
  }
});

export async function getDispatchHealth(): Promise<DispatchHealth> {
  await requireAdminContext();
  return fetchHealth();
}
