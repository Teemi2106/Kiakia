import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const state = {
  session: { userId: "vendor-staff-1", email: null, phone: null } as {
    userId: string;
    email: string | null;
    phone: string | null;
  },
  client: { current: supabaseClientMock() },
  adminClient: { current: supabaseClientMock() },
};

const requireVendorContext = vi.fn((..._args: unknown[]) => Promise.resolve(state.session));

vi.mock("@/lib/auth/dal", () => ({ requireVendorContext: (...args: unknown[]) => requireVendorContext(...args) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(() => Promise.resolve(state.client.current)) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => state.adminClient.current) }));

const {
  createCategoryAction,
  createMenuItemAction,
  deleteCategoryAction,
  deleteMenuItemAction,
  toggleItemAvailabilityAction,
  updateMenuItemAction,
} = await import("./menu");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const MY_VENDOR = "vendor-mine";
const STAFF_ROW = ok({ vendor_id: MY_VENDOR });

beforeEach(() => {
  requireVendorContext.mockClear();
  requireVendorContext.mockImplementation((..._args: unknown[]) => Promise.resolve(state.session));
  state.client.current = supabaseClientMock({ from: { vendor_staff: queryBuilder(STAFF_ROW) } });
});

describe("createCategoryAction", () => {
  it("rejects a missing category without checking staff membership", async () => {
    const result = await createCategoryAction({}, formData({ vendorId: MY_VENDOR, categoryKey: "" }));
    expect(result.error).toBeTruthy();
    expect(requireVendorContext).not.toHaveBeenCalled();
  });

  it("rejects a category key that isn't one of the fixed presets", async () => {
    const result = await createCategoryAction({}, formData({ vendorId: MY_VENDOR, categoryKey: "made-up-key" }));
    expect(result.error).toBeTruthy();
    expect(requireVendorContext).not.toHaveBeenCalled();
  });

  it("refuses a caller who doesn't staff the given vendor", async () => {
    state.client.current = supabaseClientMock({ from: { vendor_staff: queryBuilder(ok(null)) } });
    await expect(
      createCategoryAction({}, formData({ vendorId: "someone-elses-vendor", categoryKey: "soups" })),
    ).rejects.toThrow("You don't have access to this store.");
  });

  it("creates the category scoped to the caller's own vendor", async () => {
    const insert = vi.fn(() => queryBuilder(ok(null)));
    state.adminClient.current = { from: vi.fn(() => ({ insert })) } as never;
    const result = await createCategoryAction({}, formData({ vendorId: MY_VENDOR, categoryKey: "soups" }));
    expect(result.error).toBeUndefined();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ vendor_id: MY_VENDOR, category_key: "soups" }));
  });

  it("surfaces a friendly error when the vendor already added that preset (unique violation)", async () => {
    const insert = vi.fn(() => queryBuilder(fail("duplicate key", "23505")));
    state.adminClient.current = { from: vi.fn(() => ({ insert })) } as never;
    const result = await createCategoryAction({}, formData({ vendorId: MY_VENDOR, categoryKey: "soups" }));
    expect(result.error).toBe("You've already added that category.");
  });
});

describe("deleteCategoryAction (cross-vendor IDOR)", () => {
  it("refuses to delete a category belonging to a different vendor, even though the caller legitimately staffs their own vendorId", async () => {
    // Attacker staffs MY_VENDOR (passes assertVendorStaff) but supplies a
    // categoryId that belongs to some other vendor.
    state.adminClient.current = supabaseClientMock({
      from: { menu_categories: queryBuilder(ok(null)) }, // ownership lookup finds nothing for (categoryId, MY_VENDOR)
    });
    await expect(deleteCategoryAction(MY_VENDOR, "someone-elses-category")).rejects.toThrow("Category not found.");
    // The mutating calls must never be reached — proven by "menu_items" not
    // being registered in the mock at all: if the code reached it, the mock
    // would throw a *different* error ("no mock configured"), not this one.
  });

  it("deletes a category the caller's vendor actually owns", async () => {
    const menuItemsUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(ok(null))) })) }));
    const menuCategoriesDelete = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(ok(null))) })) }));
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        if (table === "menu_categories") {
          return {
            select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(ok({ id: "cat-1" })) })) })) })),
            delete: menuCategoriesDelete,
          };
        }
        if (table === "menu_items") return { update: menuItemsUpdate };
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    await deleteCategoryAction(MY_VENDOR, "cat-1");
    expect(menuItemsUpdate).toHaveBeenCalledWith({ category_id: null });
    expect(menuCategoriesDelete).toHaveBeenCalled();
  });
});

describe("updateMenuItemAction (cross-vendor IDOR)", () => {
  const VALID_FIELDS = { vendorId: MY_VENDOR, itemId: "item-1", name: "Jollof Rice", priceNaira: "2500" };

  it("rejects an invalid payload before ever checking staff membership", async () => {
    const result = await updateMenuItemAction({}, formData({ ...VALID_FIELDS, priceNaira: "-5" }));
    expect(result.error).toBeTruthy();
    expect(requireVendorContext).not.toHaveBeenCalled();
  });

  it("refuses to update a menu item belonging to a different vendor, even with a legitimate vendorId", async () => {
    state.adminClient.current = supabaseClientMock({
      from: { menu_items: queryBuilder(ok(null)) }, // (itemId, MY_VENDOR) lookup finds nothing — item belongs elsewhere
    });
    const result = await updateMenuItemAction({}, formData(VALID_FIELDS));
    expect(result.error).toBe("Menu item not found.");
  });

  it("updates an item the caller's vendor actually owns", async () => {
    const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
    let call = 0;
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        if (table === "menu_items") {
          call += 1;
          // 1st call: ownership check (select().eq().eq().maybeSingle()).
          // 2nd call: the actual update.
          if (call === 1) {
            return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(ok({ id: "item-1" })) })) })) })) };
          }
          return { update };
        }
        if (table === "option_groups") return queryBuilder(ok(null));
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    await expect(updateMenuItemAction({}, formData(VALID_FIELDS))).rejects.toThrow("NEXT_REDIRECT:/dashboard/menu");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ name: "Jollof Rice", price_kobo: 250000 }));
  });

  it("re-categorizes an existing item to a preset the vendor hasn't used before", async () => {
    const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
    let menuItemsCall = 0;
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        if (table === "menu_items") {
          menuItemsCall += 1;
          if (menuItemsCall === 1) {
            return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(ok({ id: "item-1" })) })) })) })) };
          }
          return { update };
        }
        if (table === "menu_categories") {
          return {
            select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(ok(null)) })) })) })),
            insert: vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "cat-swallow" })) })) })),
          };
        }
        if (table === "option_groups") return queryBuilder(ok(null));
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    await expect(
      updateMenuItemAction({}, formData({ ...VALID_FIELDS, categoryKey: "swallow" })),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard/menu");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ category_id: "cat-swallow" }));
  });
});

describe("deleteMenuItemAction / toggleItemAvailabilityAction (cross-vendor IDOR)", () => {
  it("deleteMenuItemAction refuses an item belonging to a different vendor", async () => {
    state.adminClient.current = supabaseClientMock({ from: { menu_items: queryBuilder(ok(null)) } });
    await expect(deleteMenuItemAction(MY_VENDOR, "someone-elses-item")).rejects.toThrow("Menu item not found.");
  });

  it("toggleItemAvailabilityAction refuses an item belonging to a different vendor", async () => {
    state.adminClient.current = supabaseClientMock({ from: { menu_items: queryBuilder(ok(null)) } });
    await expect(toggleItemAvailabilityAction(MY_VENDOR, "someone-elses-item", true)).rejects.toThrow("Menu item not found.");
  });

  it("deleteMenuItemAction deletes an item the caller's vendor owns", async () => {
    const del = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(ok(null))) }));
    let call = 0;
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        expect(table).toBe("menu_items");
        call += 1;
        if (call === 1) {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(ok({ id: "item-1" })) })) })) })) };
        }
        return { delete: del };
      }),
    } as never;

    const result = await deleteMenuItemAction(MY_VENDOR, "item-1");
    expect(result.error).toBeUndefined();
    expect(del).toHaveBeenCalled();
  });

  it("deleteMenuItemAction surfaces a friendly error instead of silently no-op'ing when the item has order history (FK violation)", async () => {
    let call = 0;
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        expect(table).toBe("menu_items");
        call += 1;
        if (call === 1) {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(ok({ id: "item-1" })) })) })) })) };
        }
        return { delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(fail("update or delete on table violates foreign key constraint", "23503"))) })) };
      }),
    } as never;

    const result = await deleteMenuItemAction(MY_VENDOR, "item-1");
    expect(result.error).toBe("This item has order history and can't be deleted. Mark it unavailable instead.");
  });

  it("toggleItemAvailabilityAction succeeds for an item the caller's vendor owns", async () => {
    const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(ok(null))) }));
    let call = 0;
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        expect(table).toBe("menu_items");
        call += 1;
        if (call === 1) {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(ok({ id: "item-1" })) })) })) })) };
        }
        return { update };
      }),
    } as never;

    await toggleItemAvailabilityAction(MY_VENDOR, "item-1", false);
    expect(update).toHaveBeenCalledWith({ is_available: false });
  });
});

describe("createMenuItemAction", () => {
  it("rejects a non-positive price", async () => {
    const result = await createMenuItemAction({}, formData({ vendorId: MY_VENDOR, name: "Rice", priceNaira: "0" }));
    expect(result.error).toBeTruthy();
    expect(requireVendorContext).not.toHaveBeenCalled();
  });

  it("creates the item scoped to the caller's own vendor and redirects", async () => {
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        if (table === "menu_items") {
          return { insert: vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "new-item" })) })) })) };
        }
        if (table === "option_groups") return queryBuilder(ok(null));
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    await expect(
      createMenuItemAction({}, formData({ vendorId: MY_VENDOR, name: "Rice", priceNaira: "2500" })),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard/menu");
  });

  it("reuses the vendor's existing category row for a preset key instead of creating a duplicate", async () => {
    const categoriesInsert = vi.fn();
    const menuItemsInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "new-item" })) })) }));
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        if (table === "menu_categories") {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(ok({ id: "cat-drinks" })) })) })) })), insert: categoriesInsert };
        }
        if (table === "menu_items") return { insert: menuItemsInsert };
        if (table === "option_groups") return queryBuilder(ok(null));
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    await expect(
      createMenuItemAction({}, formData({ vendorId: MY_VENDOR, name: "Coke", priceNaira: "500", categoryKey: "drinks" })),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard/menu");

    expect(menuItemsInsert).toHaveBeenCalledWith(expect.objectContaining({ category_id: "cat-drinks" }));
    expect(categoriesInsert).not.toHaveBeenCalled();
  });

  it("creates the vendor's category row on demand the first time a preset is picked on an item", async () => {
    const menuItemsInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "new-item" })) })) }));
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        if (table === "menu_categories") {
          return {
            select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(ok(null)) })) })) })),
            insert: vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "cat-new" })) })) })),
          };
        }
        if (table === "menu_items") return { insert: menuItemsInsert };
        if (table === "option_groups") return queryBuilder(ok(null));
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    await expect(
      createMenuItemAction({}, formData({ vendorId: MY_VENDOR, name: "Coke", priceNaira: "500", categoryKey: "drinks" })),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard/menu");

    expect(menuItemsInsert).toHaveBeenCalledWith(expect.objectContaining({ category_id: "cat-new" }));
  });

  it("rejects a category key that isn't one of the fixed presets, without touching menu_items at all", async () => {
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    const result = await createMenuItemAction(
      {},
      formData({ vendorId: MY_VENDOR, name: "Coke", priceNaira: "500", categoryKey: "made-up-key" }),
    );
    expect(result.error).toBe("Choose a valid category.");
  });

  it("S4: writes option groups using the form's actual priceDeltaNaira field, converted to kobo via nairaToKobo", async () => {
    const optionsInsert = vi.fn(() => queryBuilder(ok(null)));
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        if (table === "menu_items") {
          return { insert: vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "new-item" })) })) })) };
        }
        if (table === "option_groups") {
          return {
            delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(ok(null))) })),
            insert: vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "group-1" })) })) })),
          };
        }
        if (table === "options") return { insert: optionsInsert };
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    const optionGroups = JSON.stringify([
      { name: "Size", minSelect: 1, maxSelect: 1, isRequired: true, options: [{ name: "Large", priceDeltaNaira: 500 }] },
    ]);

    await expect(
      createMenuItemAction({}, formData({ vendorId: MY_VENDOR, name: "Rice", priceNaira: "2500", optionGroups })),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard/menu");

    expect(optionsInsert).toHaveBeenCalledWith([
      expect.objectContaining({ group_id: "group-1", name: "Large", price_delta_kobo: 50000 }),
    ]);
  });

  it("S4: rejects a negative option price with a form error instead of silently dropping the option (never reaches the options insert)", async () => {
    state.adminClient.current = {
      from: vi.fn((table: string) => {
        if (table === "menu_items") {
          return { insert: vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "new-item" })) })) })) };
        }
        if (table === "option_groups") {
          return {
            delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(ok(null))) })),
            insert: vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(ok({ id: "group-1" })) })) })),
          };
        }
        // "options" must never be reached — an invalid price is caught
        // before any insert is attempted.
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    const optionGroups = JSON.stringify([
      { name: "Size", minSelect: 1, maxSelect: 1, isRequired: true, options: [{ name: "Large", priceDeltaNaira: -5 }] },
    ]);

    const result = await createMenuItemAction(
      {},
      formData({ vendorId: MY_VENDOR, name: "Rice", priceNaira: "2500", optionGroups }),
    );
    expect(result.error).toContain("invalid price");
  });
});
