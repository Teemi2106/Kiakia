"use server";

import { redirect } from "next/navigation";
import { requireVendorContext, verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setActiveRole } from "@/lib/auth/active-role";

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
  const lat = formData.get("lat") as string | null;
  const lng = formData.get("lng") as string | null;

  if (!name || name.trim().length < 2) {
    return { error: "Enter your store name." };
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

  const admin = createAdminClient();
  const { error } = await admin
    .from("vendors")
    .update({
      name: name.trim(),
      description: (formData.get("description") as string | null) || null,
      address_line: (formData.get("addressLine") as string | null) || null,
      landmark: (formData.get("landmark") as string | null) || null,
      avg_prep_mins: Number(formData.get("avgPrepMins")) || 20,
      min_order_kobo: Math.round(Number(formData.get("minOrderNaira")) * 100) || 0,
      delivery_radius_m: Number(formData.get("deliveryRadiusM")) || 3000,
      is_accepting_orders: formData.get("isAcceptingOrders") === "on",
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
