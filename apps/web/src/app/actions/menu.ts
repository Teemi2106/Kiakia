"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadVendorImage } from "@/lib/storage/vendor-media";
import { InvalidMoneyError, isMealCategoryKey, nairaToKobo } from "@kiakia/domain";

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
 *
 * requireVendorContext(), not requireRole(VENDOR_ROLES) — holding a vendor
 * role is necessary but not sufficient; the session must also have
 * explicitly switched into vendor mode (switchToVendorAction). Every
 * action below is a Server Action reachable by direct POST regardless of
 * which layout rendered the form that normally calls it. See lib/auth/dal.ts.
 */
async function assertVendorStaff(vendorId: string): Promise<void> {
  const session = await requireVendorContext();
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

/**
 * Menu items pick a category by preset key (MEAL_CATEGORIES), not by
 * menu_categories.id — the vendor's own row for that preset is found or
 * created here, so choosing e.g. "Drinks" on an item works immediately even
 * if the vendor has never visited CategoryManager. This also closes a gap
 * where a raw categoryId used to be written straight to menu_items with no
 * check it actually belonged to this vendor.
 */
async function resolveCategoryId(
  admin: ReturnType<typeof createAdminClient>,
  vendorId: string,
  categoryKey: string | null,
): Promise<{ id: string | null } | { error: string }> {
  if (!categoryKey) return { id: null };
  if (!isMealCategoryKey(categoryKey)) return { error: "Choose a valid category." };

  const { data: existingCategory } = await admin
    .from("menu_categories")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("category_key", categoryKey)
    .maybeSingle();

  if (existingCategory) return { id: existingCategory.id };

  const { data: newCategory, error } = await admin
    .from("menu_categories")
    .insert({ vendor_id: vendorId, category_key: categoryKey })
    .select("id")
    .single();

  if (error || !newCategory) return { error: "Could not save the item's category." };

  return { id: newCategory.id };
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
  const categoryKey = formData.get("categoryKey") as string | null;
  if (!vendorId || !categoryKey || !isMealCategoryKey(categoryKey)) {
    return { error: "Choose a category." };
  }

  await assertVendorStaff(vendorId);

  const admin = createAdminClient();
  const { error } = await admin.from("menu_categories").insert({ vendor_id: vendorId, category_key: categoryKey });
  if (error) {
    // menu_categories_vendor_category_key_unique — the vendor already added this preset.
    if (error.code === "23505") return { error: "You've already added that category." };
    return { error: "Could not create category." };
  }

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

/**
 * A file input with nothing selected still submits an empty `File` (name
 * "", size 0) rather than `null` — `instanceof File && size > 0` is the
 * actual "did the vendor pick a new photo" check. When they didn't, keep
 * whatever `image_url` the item already had (the form resubmits it via a
 * hidden `currentImageUrl` field so editing other fields doesn't clear the
 * photo).
 */
type ResolveImageUrlResult = { ok: true; url: string | null } | { ok: false; error: string };

async function resolveImageUrl(vendorId: string, formData: FormData): Promise<ResolveImageUrlResult> {
  const file = formData.get("image");
  const currentImageUrl = (formData.get("currentImageUrl") as string | null) || null;

  if (!(file instanceof File) || file.size === 0) {
    return { ok: true, url: currentImageUrl };
  }

  const uploaded = await uploadVendorImage(vendorId, "menu", file);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };
  return { ok: true, url: uploaded.url };
}

interface OptionGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  // S4 (independent security review): the vendor dashboard form
  // (OptionGroupsBuilder.tsx) collects/serializes this field as
  // `priceDeltaNaira`, never `priceDeltaKobo` — the two names must match
  // what MenuItemForm.tsx actually JSON.stringifies into the hidden
  // `optionGroups` field, or every option surcharge silently gets written
  // as `undefined`/0.
  options: { name: string; priceDeltaNaira: number }[];
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

/**
 * Returns an error message on the first thing that fails to save (an
 * invalid option price, or an insert error the caller previously discarded
 * silently), or null on full success.
 *
 * S4 (independent security review): two bugs here previously —
 *   1. `option.priceDeltaKobo` doesn't exist on the client's payload (see
 *      OptionGroupInput's comment above), so every option's
 *      `price_delta_kobo` was written as `undefined`. Combined with 0016's
 *      new `price_delta_kobo >= 0` CHECK constraint, that insert now fails
 *      outright instead of silently defaulting — and the failure was
 *      discarded (`if (error || !newGroup) continue;`), leaving an option
 *      group with zero options and no indication anything went wrong.
 *   2. The options insert's own error was never checked at all.
 * Fixed by reading the field the form actually sends, converting it with
 * the same nairaToKobo() helper every other naira-to-kobo write path in
 * this codebase uses (never hand-rolled `* 100`), validating it BEFORE
 * insert, and surfacing (not swallowing) every insert error.
 */
async function writeOptionGroups(itemId: string, groups: OptionGroupInput[]): Promise<string | null> {
  const admin = createAdminClient();
  // Cascades to options (0003_catalog.sql: on delete cascade) — fresh
  // insert on every save is simpler and safer than diffing.
  await admin.from("option_groups").delete().eq("menu_item_id", itemId);

  for (const group of groups) {
    if (!group.name.trim()) continue;
    const { data: newGroup, error: groupError } = await admin
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

    if (groupError || !newGroup) {
      return `Could not save the "${group.name.trim()}" option group. Please try again.`;
    }

    const namedOptions = group.options.filter((o) => o.name.trim());
    if (namedOptions.length === 0) continue;

    const priced: { group_id: string; name: string; price_delta_kobo: number }[] = [];
    for (const option of namedOptions) {
      let priceDeltaKobo: number;
      try {
        priceDeltaKobo = nairaToKobo(option.priceDeltaNaira);
      } catch (err) {
        const detail = err instanceof InvalidMoneyError ? err.message : "invalid price";
        return `"${option.name.trim()}" has an invalid price (${detail}). Prices can't be negative.`;
      }
      priced.push({ group_id: newGroup.id, name: option.name.trim(), price_delta_kobo: priceDeltaKobo });
    }

    const { error: optionsError } = await admin.from("options").insert(priced);
    if (optionsError) {
      return `Could not save options for "${group.name.trim()}". Please try again.`;
    }
  }

  return null;
}

export async function createMenuItemAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const vendorId = formData.get("vendorId") as string | null;
  const name = formData.get("name") as string | null;
  const priceNaira = Number(formData.get("priceNaira"));

  if (!vendorId || !name?.trim() || !Number.isFinite(priceNaira) || priceNaira <= 0) {
    return { error: "Enter an item name and a valid price." };
  }

  await assertVendorStaff(vendorId);

  const admin = createAdminClient();

  const categoryKey = (formData.get("categoryKey") as string | null) || null;
  const categoryResult = await resolveCategoryId(admin, vendorId, categoryKey);
  if ("error" in categoryResult) return { error: categoryResult.error };

  const imageResult = await resolveImageUrl(vendorId, formData);
  if (!imageResult.ok) return { error: imageResult.error };

  const { data: item, error } = await admin
    .from("menu_items")
    .insert({
      vendor_id: vendorId,
      category_id: categoryResult.id,
      name: name.trim(),
      description: (formData.get("description") as string | null) || null,
      image_url: imageResult.url,
      price_kobo: Math.round(priceNaira * 100),
      is_available: formData.get("isAvailable") === "on",
    })
    .select("id")
    .single();

  if (error || !item) return { error: "Could not create menu item." };

  const optionGroupsError = await writeOptionGroups(item.id, parseOptionGroups(formData.get("optionGroups")));
  if (optionGroupsError) return { error: optionGroupsError };

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

  const admin = createAdminClient();

  const { data: existing } = await admin.from("menu_items").select("id").eq("id", itemId).eq("vendor_id", vendorId).maybeSingle();
  if (!existing) return { error: "Menu item not found." };

  const categoryKey = (formData.get("categoryKey") as string | null) || null;
  const categoryResult = await resolveCategoryId(admin, vendorId, categoryKey);
  if ("error" in categoryResult) return { error: categoryResult.error };

  const imageResult = await resolveImageUrl(vendorId, formData);
  if (!imageResult.ok) return { error: imageResult.error };

  const { error } = await admin
    .from("menu_items")
    .update({
      category_id: categoryResult.id,
      name: name.trim(),
      description: (formData.get("description") as string | null) || null,
      image_url: imageResult.url,
      price_kobo: Math.round(priceNaira * 100),
      is_available: formData.get("isAvailable") === "on",
    })
    .eq("id", itemId);

  if (error) return { error: "Could not save menu item." };

  const optionGroupsError = await writeOptionGroups(itemId, parseOptionGroups(formData.get("optionGroups")));
  if (optionGroupsError) return { error: optionGroupsError };

  revalidatePath("/dashboard/menu");
  redirect("/dashboard/menu");
}

export async function deleteMenuItemAction(vendorId: string, itemId: string): Promise<{ error?: string }> {
  await assertVendorStaff(vendorId);
  const admin = createAdminClient();
  await assertMenuItemOwnedByVendor(admin, vendorId, itemId);
  const { error } = await admin.from("menu_items").delete().eq("id", itemId);
  if (error) {
    // order_items.menu_item_id has no ON DELETE clause (0004_ordering.sql) —
    // deliberately: an order is a historical receipt (see menu_items' own
    // table comment), so an item that's actually been ordered can never be
    // hard-deleted without corrupting a customer's past receipt. Toggling
    // is_available (AvailabilityToggle) is the correct way to retire it.
    if (error.code === "23503") {
      return { error: "This item has order history and can't be deleted. Mark it unavailable instead." };
    }
    return { error: "Could not delete this item. Please try again." };
  }
  revalidatePath("/dashboard/menu");
  return {};
}

export async function toggleItemAvailabilityAction(vendorId: string, itemId: string, isAvailable: boolean): Promise<void> {
  await assertVendorStaff(vendorId);
  const admin = createAdminClient();
  await assertMenuItemOwnedByVendor(admin, vendorId, itemId);
  await admin.from("menu_items").update({ is_available: isAvailable }).eq("id", itemId);
  revalidatePath("/dashboard/menu");
}
