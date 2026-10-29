"use server";

import { rpcFailureMessage } from "@/lib/admin/action-helpers";
import { requireFleetContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fleetMessageSchema } from "@/lib/validation/fleet";

export interface FleetMessageState {
  readonly error?: string;
  /** How many riders the text was queued for; fewer than chosen means some had no phone or are suspended. */
  readonly queued?: number;
  readonly chosen?: number;
}

/**
 * Texts riders of the manager's own fleet. requireFleetContext() supplies the
 * fleet from the caller's membership, and fleet_send_message() re-checks that
 * the actor manages it and that every recipient belongs to it, so a forged
 * rider id from another fleet is refused by the database, not just here.
 */
export async function sendFleetMessageAction(_prevState: FleetMessageState, formData: FormData): Promise<FleetMessageState> {
  const { session, fleet } = await requireFleetContext();

  const parsed = fleetMessageSchema.safeParse({
    riderIds: formData.getAll("riderId").filter((value): value is string => typeof value === "string"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };

  const { data, error } = await createAdminClient().rpc("fleet_send_message", {
    p_actor_id: session.userId,
    p_fleet_id: fleet.fleetId,
    p_rider_ids: parsed.data.riderIds,
    p_body: parsed.data.body,
  });
  if (error) return { error: rpcFailureMessage(error) };

  return { queued: data ?? 0, chosen: parsed.data.riderIds.length };
}
