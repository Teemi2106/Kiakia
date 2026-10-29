import "server-only";
import { z } from "zod";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProfiles, unwrap } from "./lookups";

export interface FleetListItem {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "suspended";
  readonly createdAt: string;
  readonly managerCount: number;
  readonly riderCount: number;
  readonly onlineCount: number;
}

export interface FleetPerson {
  readonly userId: string;
  readonly fullName: string | null;
  readonly phone: string | null;
}

export interface FleetDetail {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "suspended";
  readonly createdAt: string;
  readonly managers: readonly FleetPerson[];
  readonly riders: readonly (FleetPerson & { readonly isOnline: boolean })[];
}

export async function listFleets(): Promise<FleetListItem[]> {
  await requireAdminContext();
  const admin = createAdminClient();

  const [fleets, managers, riders] = await Promise.all([
    admin.from("fleets").select("id, name, status, created_at").order("name"),
    admin.from("fleet_managers").select("fleet_id"),
    admin.from("riders").select("fleet_id, is_online").not("fleet_id", "is", null),
  ]);

  const managerCount = new Map<string, number>();
  for (const row of unwrap(managers) ?? []) managerCount.set(row.fleet_id, (managerCount.get(row.fleet_id) ?? 0) + 1);
  const riderCount = new Map<string, number>();
  const onlineCount = new Map<string, number>();
  for (const row of unwrap(riders) ?? []) {
    if (!row.fleet_id) continue;
    riderCount.set(row.fleet_id, (riderCount.get(row.fleet_id) ?? 0) + 1);
    if (row.is_online) onlineCount.set(row.fleet_id, (onlineCount.get(row.fleet_id) ?? 0) + 1);
  }

  return (unwrap(fleets) ?? []).map((fleet) => ({
    id: fleet.id,
    name: fleet.name,
    status: fleet.status,
    createdAt: fleet.created_at,
    managerCount: managerCount.get(fleet.id) ?? 0,
    riderCount: riderCount.get(fleet.id) ?? 0,
    onlineCount: onlineCount.get(fleet.id) ?? 0,
  }));
}

/** Id and name of every fleet, for the "which fleet" picker on a rider. */
export async function listFleetOptions(): Promise<{ id: string; name: string }[]> {
  await requireAdminContext();
  const rows = unwrap(await createAdminClient().from("fleets").select("id, name").order("name")) ?? [];
  return rows;
}

export async function getFleetDetail(fleetId: string): Promise<FleetDetail | null> {
  await requireAdminContext();
  if (!z.string().uuid().safeParse(fleetId).success) return null;
  const admin = createAdminClient();

  const fleet = unwrap(await admin.from("fleets").select("id, name, status, created_at").eq("id", fleetId).maybeSingle());
  if (!fleet) return null;

  const [managerRows, riderRows] = await Promise.all([
    admin.from("fleet_managers").select("user_id").eq("fleet_id", fleetId),
    admin.from("riders").select("user_id, is_online").eq("fleet_id", fleetId),
  ]);
  const managerIds = (unwrap(managerRows) ?? []).map((row) => row.user_id);
  const riders = unwrap(riderRows) ?? [];
  const profiles = await loadProfiles(admin, [...managerIds, ...riders.map((rider) => rider.user_id)]);
  const person = (userId: string): FleetPerson => ({
    userId,
    fullName: profiles.get(userId)?.fullName ?? null,
    phone: profiles.get(userId)?.phone ?? null,
  });

  return {
    id: fleet.id,
    name: fleet.name,
    status: fleet.status,
    createdAt: fleet.created_at,
    managers: managerIds.map(person),
    riders: riders.map((rider) => ({ ...person(rider.user_id), isOnline: rider.is_online })),
  };
}
