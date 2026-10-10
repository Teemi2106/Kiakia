"use server";

import { revalidatePath } from "next/cache";
import { requireFinanceContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { field, rpcFailureMessage, type FormState } from "@/lib/admin/action-helpers";
import { firstIssue, setVendorCommissionSchema, updateServiceAreaSchema } from "@/lib/validation/admin";

/**
 * Sets a vendor's commission (entered as a percentage, stored as basis
 * points). The split is computed from the vendor's commission at escrow
 * RELEASE time (0057), so a change also applies to orders that are already
 * paid but not yet delivered. Restricted to superadmins and admins holding the
 * finance role.
 */
export async function setVendorCommissionAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireFinanceContext();

  const parsed = setVendorCommissionSchema.safeParse({
    vendorId: field(formData, "vendorId"),
    commissionBps: field(formData, "commissionPercent"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { error } = await createAdminClient().rpc("admin_set_vendor_commission", {
    p_vendor_id: parsed.data.vendorId,
    p_commission_bps: parsed.data.commissionBps,
    p_reason: parsed.data.reason,
    p_actor_id: session.userId,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/vendors");
  revalidatePath(`/admin/vendors/${parsed.data.vendorId}`);
  return { success: true };
}

/**
 * Fees (entered in naira) and activation of a service area. Geometry is not
 * editable here. Same finance restriction as commissions.
 */
export async function updateServiceAreaAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireFinanceContext();

  const parsed = updateServiceAreaSchema.safeParse({
    serviceAreaId: field(formData, "serviceAreaId"),
    baseDeliveryFeeKobo: field(formData, "baseDeliveryFeeNaira"),
    perKmFeeKobo: field(formData, "perKmFeeNaira"),
    riderBaseFeeKobo: field(formData, "riderBaseFeeNaira"),
    riderPerKmFeeKobo: field(formData, "riderPerKmFeeNaira"),
    isActive: field(formData, "isActive"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { error } = await createAdminClient().rpc("admin_update_service_area", {
    p_service_area_id: parsed.data.serviceAreaId,
    p_base_delivery_fee_kobo: parsed.data.baseDeliveryFeeKobo,
    p_per_km_fee_kobo: parsed.data.perKmFeeKobo,
    p_rider_base_fee_kobo: parsed.data.riderBaseFeeKobo,
    p_rider_per_km_fee_kobo: parsed.data.riderPerKmFeeKobo,
    p_is_active: parsed.data.isActive,
    p_reason: parsed.data.reason,
    p_actor_id: session.userId,
  });
  if (error) return { error: rpcFailureMessage(error) };

  revalidatePath("/admin/settings");
  return { success: true };
}
