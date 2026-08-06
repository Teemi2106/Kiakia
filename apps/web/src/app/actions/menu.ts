"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface FormState {
  readonly error?: string;
}

/**
 * Vendor-owned menu CRUD — Server Actions writing via the admin client
 * after this action's own `vendor_staff` membership check, not new SQL
 * functions. Same reasoning as `updateVendorSettingsAction`: nine
 * near-duplicate `SECURITY DEFINER` functions for single-table CRUD buys
 * no atomicity benefit here (option groups/options ARE multi-table, but
 * still don't need row-locking/state-machine logic the way orders do) —
 * the Server Action's own auth check is the real boundary.
 */
async function assertVendorStaff(vendorId: string): Promise<void> {
  const session = await requireRole(["vendor_staff", "vendor_manager", "vendor_owner"]);
  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("vendor_staff")
    .select("vendor_id")
    .eq("vendor_id", vendorId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!staff) {
    throw new Error("You don't have access to this store.");
  }
}

/**
 * `assertVendorStaff` only proves the caller staffs `vendorId` — it says
 * nothing about whether `categoryId`/`itemId` (independent form/bound
 * params) actually belong to that vendor. Without this check, a vendor
 * could pass their own `vendorId` (to clear the staff check) alongside
 * another vendor's row id and mutate it. Every action below that targets
 * an existing category/item calls one of these first.
 */
async function assertCategoryOwnedByVendor(
  admin: ReturnType<typeof createAdminClient>,
  vendorId: string,
  categoryId: string,
): Promise<void> {
  const { data } = await admin.from("menu_categories").select("id").eq("id", categoryId).eq("vendor_id", vendorId).maybeSingle();
  if (!data) throw new Error("Category not found.");
}

async function assertMenuItemOwnedByVendor(
  admin: ReturnType<typeof createAdminClient>,
  vendorId: string,
  itemId: string,
): Promise<void> {
  const { data } = await admin.from("menu_items").select("id").eq("id", itemId).eq("vendor_id", vendorId).maybeSingle();
  if (!data) throw new Error("Menu item not found.");
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategoryAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const vendorId = formData.get("vendorId") as string | null;
  const name = formData.get("name") as string | null;
  if (!vendorId || !name?.trim()) return { error: "Enter a category name." };

  await assertVendorStaff(vendorId);

  const admin = createAdminClient();
  const { error } = await admin.from("menu_categories").insert({ vendor_id: vendorId, name: name.trim() });
  if (error) return { error: "Could not create category." };

  revalidatePath("/dashboard/menu");
  return {};
}

export async function deleteCategoryAction(vendorId: string, categoryId: string): Promise<void> {
  await assertVendorStaff(vendorId);
  const admin = createAdminClient();
  await assertCategoryOwnedByVendor(admin, vendorId, categoryId);
  await admin.from("menu_items").update({ category_id: null }).eq("category_id", categoryId).eq("vendor_id", vendorId);
  await admin.from("menu_categories").delete().eq("id", categoryId).eq("vendor_id", vendorId);
  revalidatePath("/dashboard/menu");
}

// ---------------------------------------------------------------------------
// Menu items (+ nested option groups/options)
// ---------------------------------------------------------------------------

interface OptionGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: { name: string; priceDeltaKobo: number }[];
}

function parseOptionGroups(raw: FormDataEntryValue | null): OptionGroupInput[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as OptionGroupInput[];
  } catch {
    return [];
  }
}

async function writeOptionGroups(itemId: string, groups: OptionGroupInput[]): Promise<void> {
  const admin = createAdminClient();
  // Cascades to options (0003_catalog.sql: on delete cascade) — fresh
  // insert on every save is simpler and safer than diffing.
  await admin.from("option_groups").delete().eq("menu_item_id", itemId);

  for (const group of groups) {
    if (!group.name.trim()) continue;
    const { data: newGroup, error } = await admin
      .from("option_groups")
      .insert({
        menu_item_id: itemId,
        name: group.name.trim(),
        min_select: group.minSelect,
        max_select: group.maxSelect,
        is_required: group.isRequired,
      })
      .select("id")
      .single();

    if (error || !newGroup) continue;

    const options = group.options.filter((o) => o.name.trim());
    if (options.length > 0) {
      await admin.from("options").insert(
        options.map((option) => ({
          group_id: newGroup.id,
          name: option.name.trim(),
          price_delta_kobo: option.priceDeltaKobo,
        })),
      );
    }
  }
}

export async function createMenuItemAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const vendorId = formData.get("vendorId") as string | null;
  const name = formData.get("name") as string | null;
  const priceNaira = Number(formData.get("priceNaira"));

  if (!vendorId || !name?.trim() || !Number.isFinite(priceNaira) || priceNaira <= 0) {
    return { error: "Enter an item name and a valid price." };
  }

  await assertVendorStaff(vendorId);

  const categoryId = (formData.get("categoryId") as string | null) || null;
  const admin = createAdminClient();

  const { data: item, error } = await admin
    .from("menu_items")
    .insert({
      vendor_id: vendorId,
      category_id: categoryId,
      name: name.trim(),
      description: (formData.get("description") as string | null) || null,
      image_url: (formData.get("imageUrl") as string | null) || null,
      price_kobo: Math.round(priceNaira * 100),
      is_available: formData.get("isAvailable") === "on",
    })
    .select("id")
    .single();

  if (error || !item) return { error: "Could not create menu item." };

  await writeOptionGroups(item.id, parseOptionGroups(formData.get("optionGroups")));

  revalidatePath("/dashboard/menu");
  redirect("/dashboard/menu");
}

export async function updateMenuItemAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const vendorId = formData.get("vendorId") as string | null;
  const itemId = formData.get("itemId") as string | null;
  const name = formData.get("name") as string | null;
  const priceNaira = Number(formData.get("priceNaira"));

  if (!vendorId || !itemId || !name?.trim() || !Number.isFinite(priceNaira) || priceNaira <= 0) {
    return { error: "Enter an item name and a valid price." };
  }

  await assertVendorStaff(vendorId);

  const categoryId = (formData.get("categoryId") as string | null) || null;
  const admin = createAdminClient();

  const { data: existing } = await admin.from("menu_items").select("id").eq("id", itemId).eq("vendor_id", vendorId).maybeSingle();
  if (!existing) return { error: "Menu item not found." };

  const { error } = await admin
    .from("menu_items")
    .update({
      category_id: categoryId,
      name: name.trim(),
      description: (formData.get("description") as string | null) || null,
      image_url: (formData.get("imageUrl") as string | null) || null,
      price_kobo: Math.round(priceNaira * 100),
      is_available: formData.get("isAvailable") === "on",
    })
    .eq("id", itemId);

  if (error) return { error: "Could not save menu item." };

  await writeOptionGroups(itemId, parseOptionGroups(formData.get("optionGroups")));

  revalidatePath("/dashboard/menu");
  redirect("/dashboard/menu");
}

export async function deleteMenuItemAction(vendorId: string, itemId: string): Promise<void> {
  await assertVendorStaff(vendorId);
  const admin = createAdminClient();
  await assertMenuItemOwnedByVendor(admin, vendorId, itemId);
  await admin.from("menu_items").delete().eq("id", itemId);
  revalidatePath("/dashboard/menu");
}

export async function toggleItemAvailabilityAction(vendorId: string, itemId: string, isAvailable: boolean): Promise<void> {
  await assertVendorStaff(vendorId);
  const admin = createAdminClient();
  await assertMenuItemOwnedByVendor(admin, vendorId, itemId);
  await admin.from("menu_items").update({ is_available: isAvailable }).eq("id", itemId);
  revalidatePath("/dashboard/menu");
}
