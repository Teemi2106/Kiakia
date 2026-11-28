"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Json } from "@kiakia/db";
import { isMealCategoryKey, nairaToKobo, parseMenuPriceKobo } from "@kiakia/domain";
import type { FormState } from "@/app/actions/menu";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadVendorImage } from "@/lib/storage/vendor-media";

const optionGroupsSchema = z.array(
  z.object({
    name: z.string().trim().max(100),
    minSelect: z.number().int().min(0).max(50),
    maxSelect: z.number().int().min(1).max(50),
    isRequired: z.boolean(),
    options: z.array(z.object({
      name: z.string().trim().max(100),
      priceDeltaNaira: z.number().finite().min(0).max(1_000_000),
    })).max(50),
  }).refine((group) => group.maxSelect >= group.minSelect && (!group.isRequired || group.minSelect >= 1), {
    message: "An option group's maximum must be at least its minimum.",
  }),
).max(20);

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : null;
}

function readOptionGroups(formData: FormData): { value: Json } | { error: string } {
  const raw = formData.get("optionGroups");
  if (typeof raw !== "string") return { value: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Check the item options and try again." };
  }

  const result = optionGroupsSchema.safeParse(parsed);
  if (!result.success) return { error: "Check the item options and try again." };

  try {
    const groups = result.data.flatMap((group) => {
      const name = group.name.trim();
      if (!name) return [];
      const options = group.options.flatMap((option) => {
        const optionName = option.name.trim();
        if (!optionName) return [];
        return [{ name: optionName, price_delta_kobo: nairaToKobo(option.priceDeltaNaira) }];
      });
      return [{
        name,
        min_select: group.minSelect,
        max_select: group.maxSelect,
        is_required: group.isRequired,
        options,
      }];
    });
    return { value: groups as Json };
  } catch {
    return { error: "Each extra needs a valid price." };
  }
}

/** Creates a vendor menu item on behalf of a vendor and records the admin change in the audit log. */
export async function createAdminVendorMenuItemAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAdminContext();
  const vendorId = field(formData, "vendorId");
  const name = field(formData, "name");
  const description = field(formData, "description");
  const categoryKey = field(formData, "categoryKey") || null;
  const priceKobo = parseMenuPriceKobo(formData.get("priceNaira"));

  if (!vendorId || !z.string().uuid().safeParse(vendorId).success) return { error: "Choose a valid vendor." };
  if (!name) return { error: "Enter an item name and price." };
  if (name.length > 120) return { error: "Item names must be 120 characters or fewer." };
  if (description && description.length > 1000) return { error: "Descriptions must be 1,000 characters or fewer." };
  if (priceKobo === null) return { error: "Enter a valid price between ₦0.01 and ₦1,000,000." };
  if (categoryKey && !isMealCategoryKey(categoryKey)) return { error: "Choose a valid category." };

  const optionGroups = readOptionGroups(formData);
  if ("error" in optionGroups) return { error: optionGroups.error };

  let imageUrl: string | null = null;
  let imagePath: string | null = null;
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    const uploaded = await uploadVendorImage(vendorId, "menu", image);
    if (!uploaded.ok) return { error: uploaded.error };
    imageUrl = uploaded.url;
    imagePath = uploaded.path;
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_create_vendor_menu_item", {
    p_actor_id: actor.userId,
    p_vendor_id: vendorId,
    p_name: name,
    p_description: description || null,
    p_image_url: imageUrl,
    p_price_kobo: priceKobo,
    p_category_key: categoryKey,
    p_is_available: formData.get("isAvailable") === "on",
    p_option_groups: optionGroups.value,
  });

  if (error) {
    if (imagePath) {
      try {
        await admin.storage.from("vendor-media").remove([imagePath]);
      } catch {
        // A failed item insert should not be hidden by best-effort image cleanup.
      }
    }
    if (error.code === "P0002") return { error: "This vendor could not be found." };
    return { error: "Could not add this menu item. Please try again." };
  }

  revalidatePath(`/admin/vendors/${vendorId}`);
  revalidatePath(`/admin/vendors/${vendorId}/menu/new`);
  revalidatePath("/vendors/[slug]", "page");
  redirect(`/admin/vendors/${vendorId}/menu/new?added=1`);
}
