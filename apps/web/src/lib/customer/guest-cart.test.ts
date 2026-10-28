import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CartLineItem, CartResult } from "@/lib/cart";
import type { CustomerSnapshot } from "./types";

const gateway = {
  createCart: vi.fn<(...args: unknown[]) => Promise<CartResult>>(),
  abandonCart: vi.fn<(...args: unknown[]) => Promise<CartResult>>(),
  insertCartLine: vi.fn<(...args: unknown[]) => Promise<CartResult>>(),
  setCartLineQty: vi.fn<(...args: unknown[]) => Promise<CartResult>>(),
  deleteCartLine: vi.fn<(...args: unknown[]) => Promise<CartResult>>(),
  deleteAllCartLines: vi.fn<(...args: unknown[]) => Promise<CartResult>>(),
};
vi.mock("@/lib/cart", () => gateway);

const { createCustomerStore } = await import("./store");
const { GUEST_USER_ID, readGuestCart } = await import("./guest-cart");

const OK: CartResult = { ok: true };

const GUEST: CustomerSnapshot = { userId: GUEST_USER_ID, cart: null, lines: [], unreadCount: 0, addressLabel: null };
const ACCOUNT: CustomerSnapshot = { userId: "user-1", cart: null, lines: [], unreadCount: 0, addressLabel: null };

const addInput = (vendorId = "vendor-1", menuItemId = "item-1") => ({
  vendorId,
  vendorName: `Vendor ${vendorId}`,
  menuItemId,
  name: `Dish ${menuItemId}`,
  unitPriceKobo: 1_500,
  qty: 2,
  options: [],
});

function stubLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  });
  return data;
}

let storage: Map<string, string>;

beforeEach(() => {
  for (const fn of Object.values(gateway)) fn.mockReset().mockResolvedValue(OK);
  storage = stubLocalStorage();
});

describe("signed-out cart", () => {
  it("adds without touching the database and survives in localStorage", async () => {
    const store = createCustomerStore(GUEST);

    expect(await store.getState().addToCart(addInput())).toBe(true);

    expect(Object.values(gateway).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    expect(store.getState().lines).toHaveLength(1);
    expect(readGuestCart()?.lines).toHaveLength(1);
  });

  it("restores the saved cart on a fresh store and keeps it through a server snapshot", async () => {
    await createCustomerStore(GUEST).getState().addToCart(addInput());

    const store = createCustomerStore(GUEST);
    expect(store.getState().lines).toHaveLength(0);
    store.getState().loadGuestCart();
    expect(store.getState().lines).toHaveLength(1);

    store.getState().hydrate(GUEST);
    expect(store.getState().lines).toHaveLength(1);
  });

  it("empties storage when the last line is removed", async () => {
    const store = createCustomerStore(GUEST);
    await store.getState().addToCart(addInput());

    await store.getState().removeLine(store.getState().lines[0].id);

    expect(storage.size).toBe(0);
    expect(store.getState().cart).toBeNull();
  });

  it("ignores a corrupt or hostile stored value", () => {
    storage.set("kk_guest_cart_v1", "{not json");
    expect(readGuestCart()).toBeNull();

    storage.set(
      "kk_guest_cart_v1",
      JSON.stringify({ cart: { id: "c", vendorId: "v" }, lines: [{ id: "l", qty: 5000 }] }),
    );
    expect(readGuestCart()).toBeNull();
  });
});

describe("mergeGuestCart", () => {
  async function saveGuestCart(...inputs: ReturnType<typeof addInput>[]) {
    const guest = createCustomerStore(GUEST);
    for (const input of inputs) await guest.getState().addToCart(input);
  }

  it("writes the signed-out cart into the account's cart once, then clears it", async () => {
    await saveGuestCart(addInput("vendor-1", "item-1"), addInput("vendor-1", "item-2"));
    const store = createCustomerStore(ACCOUNT);

    await store.getState().mergeGuestCart();
    await store.getState().mergeGuestCart();

    expect(gateway.createCart).toHaveBeenCalledTimes(1);
    expect(gateway.insertCartLine).toHaveBeenCalledTimes(2);
    expect(store.getState().lines.map((l) => l.menu_item_id)).toEqual(["item-1", "item-2"]);
    expect(store.getState().guestMerged).toBe(true);
    expect(storage.size).toBe(0);
  });

  it("adds to the quantity of a plain item already in the account's cart", async () => {
    await saveGuestCart(addInput("vendor-1", "item-1"));
    const existing: CartLineItem = {
      id: "line-a",
      menu_item_id: "item-1",
      menu_item_image_url: null,
      name_snapshot: "Dish item-1",
      unit_price_kobo: 1_500,
      qty: 1,
      options_snapshot: [],
      line_total_kobo: 1_500,
    };
    const store = createCustomerStore({
      ...ACCOUNT,
      cart: { id: "cart-1", vendorId: "vendor-1", vendorName: "Vendor vendor-1" },
      lines: [existing],
    });

    await store.getState().mergeGuestCart();

    expect(gateway.insertCartLine).not.toHaveBeenCalled();
    expect(gateway.setCartLineQty).toHaveBeenCalledWith("line-a", 3, 1_500);
  });

  it("replaces an older cart from a different vendor with what was just chosen", async () => {
    await saveGuestCart(addInput("vendor-2", "item-9"));
    const store = createCustomerStore({
      ...ACCOUNT,
      cart: { id: "old-cart", vendorId: "vendor-1", vendorName: "Vendor vendor-1" },
      lines: [
        {
          id: "old-line",
          menu_item_id: "item-1",
          menu_item_image_url: null,
          name_snapshot: "Old",
          unit_price_kobo: 100,
          qty: 1,
          options_snapshot: [],
          line_total_kobo: 100,
        },
      ],
    });

    await store.getState().mergeGuestCart();

    expect(gateway.abandonCart).toHaveBeenCalledWith("old-cart");
    expect(store.getState().cart?.vendorId).toBe("vendor-2");
    expect(store.getState().lines.map((l) => l.menu_item_id)).toEqual(["item-9"]);
  });

  it("is a no-op that still releases waiters when nothing was saved", async () => {
    const store = createCustomerStore(ACCOUNT);

    await store.getState().mergeGuestCart();

    expect(store.getState().guestMerged).toBe(true);
    expect(gateway.createCart).not.toHaveBeenCalled();
  });
});
