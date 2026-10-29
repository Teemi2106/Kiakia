"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, rpcFailureMessage, type FormState } from "@/lib/admin/action-helpers";
import { listUsers } from "@/lib/admin/users";
import { isSuperadmin, requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { firstIssue } from "@/lib/validation/admin";
import {
  addFleetManagerSchema,
  createFleetSchema,
  removeFleetManagerSchema,
  setFleetStatusSchema,
  setRiderFleetSchema,
} from "@/lib/validation/fleet";

/**
 * Fleet administration. requireAdminContext() is the boundary; each RPC
 * (0113) is service_role only, re-verifies the actor and writes the audit row
 * in the same transaction.
 */

export async function createFleetAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  const parsed = createFleetSchema.safeParse({ name: field(formData, "name"), reason: field(formData, "reason") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { data: fleetId, error } = await createAdminClient().rpc("admin_create_fleet", {
    p_actor_id: session.userId,
    p_name: parsed.data.name,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    return { error: error.code === "23505" ? "A fleet with that name already exists." : rpcFailureMessage(error) };
  }

  revalidatePath("/admin/fleets");
  redirect(`/admin/fleets/${fleetId}`);
}

export interface AccountMatch {
  readonly id: string;
  readonly fullName: string | null;
  readonly phone: string | null;
}

/** Type-ahead for the manager picker: active accounts whose name or phone matches. Admin only. */
export async function searchAccountsAction(query: string): Promise<AccountMatch[]> {
  await requireAdminContext();
  const term = typeof query === "string" ? query.trim().slice(0, 64) : "";
  if (term.length < 2) return [];

  const page = await listUsers({ q: term, status: "active", pageSize: 8 });
  return page.rows.map((user) => ({ id: user.id, fullName: user.fullName, phone: user.phone }));
}

const SUPERADMIN_ONLY = "Only a superadmin can add or remove fleet managers. Ask a superadmin to do it.";

/** Adds an existing account, chosen from the search picker, as a manager of the fleet. */
export async function addFleetManagerAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  if (!(await isSuperadmin())) return { error: SUPERADMIN_ONLY };
  const parsed = addFleetManagerSchema.safeParse({
    fleetId: field(formData, "fleetId"),
    userId: field(formData, "userId"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { data: added, error } = await createAdminClient().rpc("admin_add_fleet_manager", {
    p_actor_id: session.userId,
    p_fleet_id: parsed.data.fleetId,
    p_user_id: parsed.data.userId,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath(`/admin/fleets/${parsed.data.fleetId}`);
  return added ? { success: true } : { success: true, message: "They already manage this fleet." };
}

export async function removeFleetManagerAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  if (!(await isSuperadmin())) return { error: SUPERADMIN_ONLY };
  const parsed = removeFleetManagerSchema.safeParse({
    fleetId: field(formData, "fleetId"),
    userId: field(formData, "userId"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { error } = await createAdminClient().rpc("admin_remove_fleet_manager", {
    p_actor_id: session.userId,
    p_fleet_id: parsed.data.fleetId,
    p_user_id: parsed.data.userId,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath(`/admin/fleets/${parsed.data.fleetId}`);
  return { success: true };
}

export async function setFleetStatusAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  const parsed = setFleetStatusSchema.safeParse({
    fleetId: field(formData, "fleetId"),
    status: field(formData, "status"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { error } = await createAdminClient().rpc("admin_set_fleet_status", {
    p_actor_id: session.userId,
    p_fleet_id: parsed.data.fleetId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/fleets");
  revalidatePath(`/admin/fleets/${parsed.data.fleetId}`);
  return { success: true };
}

/** Attaches a rider to a fleet, or detaches them when no fleet is chosen. */
export async function setRiderFleetAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdminContext();
  const parsed = setRiderFleetSchema.safeParse({
    riderId: field(formData, "riderId"),
    fleetId: field(formData, "fleetId"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { error } = await createAdminClient().rpc("admin_set_rider_fleet", {
    p_actor_id: session.userId,
    p_rider_id: parsed.data.riderId,
    p_fleet_id: parsed.data.fleetId ?? null,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/fleets");
  revalidatePath(`/admin/riders/${parsed.data.riderId}`);
  if (parsed.data.fleetId) revalidatePath(`/admin/fleets/${parsed.data.fleetId}`);
  return { success: true };
}
