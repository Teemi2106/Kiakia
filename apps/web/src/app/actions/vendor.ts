"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVendorContext, verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setActiveRole } from "@/lib/auth/active-role";
import { uploadVendorImage } from "@/lib/storage/vendor-media";
import type { Json } from "@kiakia/db";

const VENDOR_STAFF_ROLES = ["vendor_staff", "vendor_manager", "vendor_owner"] as const;
type VendorStaffRole = (typeof VENDOR_STAFF_ROLES)[number];

async function assertVendorStaff(vendorId: string): Promise<{ userId: string; role: VendorStaffRole }> {
  const session = await requireVendorContext();
  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("vendor_staff")
    .select("role")
    .eq("vendor_id", vendorId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!staff) throw new Error("You don't have access to this store.");
  return { userId: session.userId, role: staff.role as VendorStaffRole };
}

export interface FormState {
  readonly error?: string;
  readonly success?: boolean;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vendor"
  );
}

/**
 * register_vendor() is SECURITY DEFINER + grant execute to authenticated
 * (0009_register_vendor.sql) — this action's job is just shaping the form
 * into RPC args and handling the slug-collision retry, not authorization;
 * the RPC itself checks the caller doesn't already have a vendor.
 */
export async function registerVendorAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  await verifySession();

  const name = formData.get("name") as string | null;
  const category = (formData.get("category") as string | null) || "food";
  const description = (formData.get("description") as string | null) || null;
  const addressLine = (formData.get("addressLine") as string | null) || null;
  const landmark = (formData.get("landmark") as string | null) || null;
  const state = (formData.get("state") as string | null)?.trim() || null;
  const lat = formData.get("lat") as string | null;
  const lng = formData.get("lng") as string | null;

  if (!name || name.trim().length < 2) {
    return { error: "Enter your store name." };
  }
  if (!state) {
    return { error: "Enter your store's state." };
  }

  const supabase = await createClient();
  const baseSlug = slugify(name);

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const { data: vendor, error } = await supabase.rpc("register_vendor", {
      p_name: name.trim(),
      p_slug: slug,
      p_category: category,
      p_description: description,
      p_address_line: addressLine,
      p_landmark: landmark,
      p_location: lat && lng ? `POINT(${lng} ${lat})` : null,
      p_state: state,
    });

    if (!error && vendor) {
      // Creating the store is itself the explicit switch — go straight into
      // vendor mode rather than leaving them in customer mode on their own
      // brand-new dashboard.
      await setActiveRole("vendor");
      redirect("/dashboard");
    }

    if (error?.message.includes("one vendor per account")) {
      return { error: "This account is already linked to a vendor." };
    }
    if (!error?.message.includes("duplicate key") && !error?.code?.includes("23505")) {
      return { error: "We couldn't create your store. Please try again." };
    }
    // Slug collision — loop and retry with a suffixed slug.
  }

  return { error: "We couldn't find an available store URL. Try a different store name." };
}

/**
 * Vendor-owned CRUD, not a SECURITY DEFINER RPC — see the plan's reasoning:
 * this Server Action's own `requireVendorContext` + vendor_staff membership
 * check IS the authorization boundary, same pattern as order placement
 * (§5). requireVendorContext(), not requireRole(VENDOR_ROLES) — holding a
 * vendor role is necessary but not sufficient; the session must also have
 * explicitly switched into vendor mode (switchToVendorAction) — this is a
 * Server Action reachable by direct POST regardless of which layout
 * rendered the settings form. Writes via the admin client because
 * `vendors` UPDATE is revoked from `authenticated` (0007_rls.sql).
 * `status`/`kyc_status` are deliberately not accepted here — still
 * admin-only/manual-SQL, per §22.
 */
export async function updateVendorSettingsAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireVendorContext();

  const vendorId = formData.get("vendorId") as string | null;
  if (!vendorId) return { error: "Missing store." };

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("vendor_staff")
    .select("vendor_id")
    .eq("vendor_id", vendorId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!staff) {
    return { error: "You don't have access to this store." };
  }

  const name = formData.get("name") as string | null;
  if (!name || name.trim().length < 2) {
    return { error: "Enter your store name." };
  }

  // A file input with nothing selected still submits an empty File (name
  // "", size 0), not null — only upload, and only overwrite banner_url,
  // when the vendor actually picked a new photo. Otherwise keep whatever
  // banner the store already had (resubmitted via the hidden
  // currentBannerUrl field so saving other settings doesn't clear it).
  const bannerFile = formData.get("banner");
  const currentBannerUrl = (formData.get("currentBannerUrl") as string | null) || null;
  let bannerUrl = currentBannerUrl;

  if (bannerFile instanceof File && bannerFile.size > 0) {
    const uploaded = await uploadVendorImage(vendorId, "banner", bannerFile);
    if (!uploaded.ok) return { error: uploaded.error };
    bannerUrl = uploaded.url;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("vendors")
    .update({
      name: name.trim(),
      description: (formData.get("description") as string | null) || null,
      address_line: (formData.get("addressLine") as string | null) || null,
      landmark: (formData.get("landmark") as string | null) || null,
      state: (formData.get("state") as string | null)?.trim() || null,
      avg_prep_mins: Number(formData.get("avgPrepMins")) || 20,
      min_order_kobo: Math.round(Number(formData.get("minOrderNaira")) * 100) || 0,
      delivery_radius_m: Number(formData.get("deliveryRadiusM")) || 3000,
      is_accepting_orders: formData.get("isAcceptingOrders") === "on",
      banner_url: bannerUrl,
    })
    .eq("id", vendorId);

  if (error) {
    return { error: "Could not save your settings." };
  }

  return { success: true };
}

/**
 * set_vendor_location() is SECURITY DEFINER + grant execute to authenticated
 * (0032_vendor_location_and_rider_reads.sql) — its own vendor_staff
 * membership check on p_vendor_id (any role tier, same idiom
 * updateVendorSettingsAction's own check above uses) IS the authorization
 * boundary, same pattern as register_vendor()/accept_dispatch_offer(). This
 * action still calls requireVendorContext() itself before shaping the form
 * into RPC args — reachable by direct POST regardless of which layout
 * rendered the settings form, same reasoning as every other Server Action
 * here. Uses the session-scoped client (not the admin client): unlike
 * updateVendorSettingsAction, this write goes through an RPC that already
 * re-derives its own authorization server-side, not a bare `vendors` UPDATE
 * (which RLS revokes from `authenticated` outright, 0007_rls.sql).
 */
export async function updateVendorLocationAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  await requireVendorContext();

  const vendorId = formData.get("vendorId") as string | null;
  if (!vendorId) return { error: "Missing store." };

  const latRaw = formData.get("lat") as string | null;
  const lngRaw = formData.get("lng") as string | null;
  const lat = latRaw ? Number(latRaw) : NaN;
  const lng = lngRaw ? Number(lngRaw) : NaN;

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: "Enter a valid latitude between -90 and 90." };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { error: "Enter a valid longitude between -180 and 180." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_vendor_location", {
    p_vendor_id: vendorId,
    p_lat: lat,
    p_lng: lng,
  });

  if (error) {
    return { error: "Could not update your store location." };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Operating hours
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface DayHours {
  day: number; // 0 (Sunday) .. 6 (Saturday), matching JS Date#getDay()
  isOpen: boolean;
  opensAt: string; // "HH:MM", ignored when isOpen is false
  closesAt: string;
}

function parseOperatingHours(raw: FormDataEntryValue | null): DayHours[] | null {
  if (!raw || typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 7) return null;

  const days = new Set<number>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return null;
    const { day, isOpen, opensAt, closesAt } = entry as Record<string, unknown>;
    if (typeof day !== "number" || day < 0 || day > 6 || days.has(day)) return null;
    days.add(day);
    if (typeof isOpen !== "boolean") return null;
    if (isOpen && (typeof opensAt !== "string" || typeof closesAt !== "string" || !TIME_RE.test(opensAt) || !TIME_RE.test(closesAt))) {
      return null;
    }
  }

  return parsed as DayHours[];
}

/**
 * Vendor-owned CRUD via the admin client after this action's own
 * vendor_staff check — same idiom as updateVendorSettingsAction, not a new
 * RPC (single-column write, no cross-table invariant to protect).
 */
export async function updateVendorOperatingHoursAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const vendorId = formData.get("vendorId") as string | null;
  if (!vendorId) return { error: "Missing store." };

  await assertVendorStaff(vendorId);

  const hours = parseOperatingHours(formData.get("operatingHours"));
  if (!hours) return { error: "Could not save operating hours. Please try again." };

  const admin = createAdminClient();
  const { error } = await admin.from("vendors").update({ opening_hours: hours as unknown as Json }).eq("id", vendorId);
  if (error) return { error: "Could not save operating hours. Please try again." };

  revalidatePath("/dashboard/settings");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Staff members
// ---------------------------------------------------------------------------

/**
 * Only the store's owner(s) can add or remove staff — a manager/staff
 * member managing their own peers isn't a case this app needs yet, and
 * getting it wrong would let a lower tier lock out an owner.
 */
async function assertVendorOwner(vendorId: string): Promise<void> {
  const { role } = await assertVendorStaff(vendorId);
  if (role !== "vendor_owner") throw new Error("Only the store owner can manage staff.");
}

/**
 * There's no invitation-link/email infrastructure in this app yet (no
 * transactional email provider is wired up anywhere) — this only works for
 * an email that already has a KiaKia account, found via the GoTrue admin
 * API (no direct "get user by email" method in supabase-js; auth.users
 * itself isn't exposed through PostgREST, so a table query isn't an option
 * either). Listing is unpaginated past the first page, which is fine at
 * this app's current scale and wrong at a much larger one — flagged here
 * rather than silently accepted as correct forever.
 */
export async function inviteStaffMemberAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const vendorId = formData.get("vendorId") as string | null;
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const role = (formData.get("role") as string | null) || "vendor_staff";

  if (!vendorId) return { error: "Missing store." };
  if (!email) return { error: "Enter an email address." };
  if (!VENDOR_STAFF_ROLES.includes(role as VendorStaffRole)) return { error: "Invalid role." };

  await assertVendorOwner(vendorId);

  const admin = createAdminClient();
  const { data: usersPage, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) return { error: "Could not look up that account. Please try again." };

  const user = usersPage.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    return { error: "No KiaKia account exists for that email yet — they'll need to register first." };
  }

  const { data: existingStaff } = await admin.from("vendor_staff").select("user_id").eq("vendor_id", vendorId).eq("user_id", user.id).maybeSingle();
  if (existingStaff) return { error: "That person is already staff at this store." };

  const { error } = await admin.from("vendor_staff").insert({ vendor_id: vendorId, user_id: user.id, role: role as VendorStaffRole });
  if (error) return { error: "Could not add that staff member. Please try again." };

  revalidatePath("/dashboard/settings");
  return { success: true };
}

export async function removeStaffMemberAction(vendorId: string, userId: string): Promise<{ error?: string }> {
  await assertVendorOwner(vendorId);

  const admin = createAdminClient();

  // Never let the store end up with zero owners — that would permanently
  // lock everyone out of staff management (assertVendorOwner would have
  // nothing left to authorize against).
  const { data: staffRow } = await admin.from("vendor_staff").select("role").eq("vendor_id", vendorId).eq("user_id", userId).maybeSingle();
  if (staffRow?.role === "vendor_owner") {
    const { count } = await admin
      .from("vendor_staff")
      .select("user_id", { count: "exact", head: true })
      .eq("vendor_id", vendorId)
      .eq("role", "vendor_owner");
    if ((count ?? 0) <= 1) {
      return { error: "A store must always have at least one owner." };
    }
  }

  const { error } = await admin.from("vendor_staff").delete().eq("vendor_id", vendorId).eq("user_id", userId);
  if (error) return { error: "Could not remove that staff member." };

  revalidatePath("/dashboard/settings");
  return {};
}
