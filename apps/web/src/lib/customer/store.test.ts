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

const { createCustomerStore, plainLineFor, selectItemCount } = await import("./store");

const USER = "user-1";
const OK: CartResult = { ok: true };
const FAIL: CartResult = { ok: false, error: "nope" };

function line(id: string, qty = 1, menuItemId = `item-${id}`): CartLineItem {
  return {
    id,
    menu_item_id: menuItemId,
    menu_item_image_url: null,
    name_snapshot: `Dish ${id}`,
    unit_price_kobo: 1_000,
    qty,
    options_snapshot: [],
    line_total_kobo: 1_000 * qty,
  };
}

function snapshot(overrides: Partial<CustomerSnapshot> = {}): CustomerSnapshot {
  return {
    userId: USER,
    cart: { id: "cart-1", vendorId: "vendor-1", vendorName: "Vendor One" },
    lines: [line("a", 2)],
    unreadCount: 3,
    addressLabel: "Home",
    ...overrides,
  };
}

const addInput = (vendorId = "vendor-1") => ({
  vendorId,
  vendorName: `Vendor ${vendorId}`,
  menuItemId: "item-new",
  name: "New dish",
  unitPriceKobo: 2_500,
  qty: 2,
  options: [],
});

/** A write whose response the test releases by hand. */
function deferred() {
  let resolve!: (result: CartResult) => void;
  const promise = new Promise<CartResult>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  for (const fn of Object.values(gateway)) fn.mockReset().mockResolvedValue(OK);
});

describe("addToCart", () => {
  it("adds to a known same-vendor cart with exactly one insert and no lookups", async () => {
    const store = createCustomerStore(snapshot());
    const write = deferred();
    gateway.insertCartLine.mockReturnValueOnce(write.promise);

    const added = store.getState().addToCart(addInput());

    // Optimistic: visible before the write has come back.
    expect(store.getState().lines).toHaveLength(2);
    expect(selectItemCount(store.getState())).toBe(4);

    write.resolve(OK);
    await expect(added).resolves.toBe(true);

    expect(gateway.insertCartLine).toHaveBeenCalledOnce();
    expect(gateway.insertCartLine.mock.calls[0][0]).toBe("cart-1");
    expect(gateway.createCart).not.toHaveBeenCalled();
    expect(gateway.abandonCart).not.toHaveBeenCalled();
  });

  it("undoes only its own line and posts an error when the insert fails", async () => {
    const store = createCustomerStore(snapshot());
    gateway.insertCartLine.mockResolvedValueOnce(FAIL);

    await expect(store.getState().addToCart(addInput())).resolves.toBe(false);

    expect(store.getState().lines.map((l) => l.id)).toEqual(["a"]);
    expect(store.getState().cart?.id).toBe("cart-1");
    expect(store.getState().notice).toMatchObject({ tone: "error", text: "nope" });
  });

  it("creates a cart, then inserts, when there is none yet", async () => {
    const store = createCustomerStore(snapshot({ cart: null, lines: [] }));
    const order: string[] = [];
    gateway.createCart.mockImplementationOnce(async () => (order.push("create"), OK));
    gateway.insertCartLine.mockImplementationOnce(async () => (order.push("insert"), OK));

    await store.getState().addToCart(addInput());

    expect(order).toEqual(["create", "insert"]);
    const [cartId, userId, vendorId] = gateway.createCart.mock.calls[0];
    expect(userId).toBe(USER);
    expect(vendorId).toBe("vendor-1");
    expect(store.getState().cart?.id).toBe(cartId);
    expect(gateway.insertCartLine.mock.calls[0][0]).toBe(cartId);
  });

  it("drops the optimistic cart when starting one fails", async () => {
    const store = createCustomerStore(snapshot({ cart: null, lines: [] }));
    gateway.createCart.mockResolvedValueOnce(FAIL);

    await store.getState().addToCart(addInput());

    expect(store.getState().cart).toBeNull();
    expect(store.getState().lines).toEqual([]);
    expect(gateway.insertCartLine).not.toHaveBeenCalled();
  });

  it("changes nothing when the customer declines to leave the other vendor's cart", async () => {
    const store = createCustomerStore(snapshot());
    const confirmSwitch = vi.fn(() => false);

    await expect(store.getState().addToCart(addInput("vendor-2"), confirmSwitch)).resolves.toBe(false);

    expect(confirmSwitch).toHaveBeenCalledWith("New dish");
    expect(store.getState().cart?.vendorId).toBe("vendor-1");
    expect(store.getState().lines).toHaveLength(1);
    expect(gateway.abandonCart).not.toHaveBeenCalled();
  });

  it("abandons the old cart and starts a new one on a confirmed vendor switch", async () => {
    const store = createCustomerStore(snapshot());
    const order: string[] = [];
    gateway.abandonCart.mockImplementationOnce(async () => (order.push("abandon"), OK));
    gateway.createCart.mockImplementationOnce(async () => (order.push("create"), OK));
    gateway.insertCartLine.mockImplementationOnce(async () => (order.push("insert"), OK));

    await expect(store.getState().addToCart(addInput("vendor-2"), () => true)).resolves.toBe(true);

    expect(order).toEqual(["abandon", "create", "insert"]);
    expect(gateway.abandonCart).toHaveBeenCalledWith("cart-1");
    expect(store.getState().cart).toMatchObject({ vendorId: "vendor-2", vendorName: "Vendor vendor-2" });
    expect(store.getState().lines).toHaveLength(1);
  });

  it("restores the old cart if abandoning it fails, and empties it if the later steps fail", async () => {
    const store = createCustomerStore(snapshot());
    gateway.abandonCart.mockResolvedValueOnce(FAIL);
    await store.getState().addToCart(addInput("vendor-2"), () => true);
    expect(store.getState().cart?.vendorId).toBe("vendor-1");
    expect(store.getState().lines.map((l) => l.id)).toEqual(["a"]);

    gateway.createCart.mockResolvedValueOnce(FAIL);
    await store.getState().addToCart(addInput("vendor-2"), () => true);
    expect(store.getState().cart).toBeNull();
    expect(store.getState().lines).toEqual([]);
  });

  it("rejects an out-of-range quantity without touching state or the database", async () => {
    const store = createCustomerStore(snapshot());

    await expect(store.getState().addToCart({ ...addInput(), qty: 0 })).resolves.toBe(false);

    expect(store.getState().lines).toHaveLength(1);
    expect(store.getState().notice?.tone).toBe("error");
    expect(gateway.insertCartLine).not.toHaveBeenCalled();
  });

  it("sends writes in tap order", async () => {
    const store = createCustomerStore(snapshot({ cart: null, lines: [] }));
    const create = deferred();
    gateway.createCart.mockReturnValueOnce(create.promise);

    const first = store.getState().addToCart(addInput());
    const second = store.getState().addToCart({ ...addInput(), menuItemId: "item-2" });
    await Promise.resolve();

    // The second insert must wait for the cart row the first one is creating.
    expect(gateway.insertCartLine).not.toHaveBeenCalled();
    create.resolve(OK);
    await Promise.all([first, second]);

    expect(gateway.createCart).toHaveBeenCalledOnce();
    expect(gateway.insertCartLine).toHaveBeenCalledTimes(2);
  });
});

describe("setQty / removeLine / clearCart", () => {
  it("updates the quantity and line total at once, then writes with the known price", async () => {
    const store = createCustomerStore(snapshot());
    const write = deferred();
    gateway.setCartLineQty.mockReturnValueOnce(write.promise);

    const pending = store.getState().setQty("a", 5);
    expect(store.getState().lines[0]).toMatchObject({ qty: 5, line_total_kobo: 5_000 });
    expect(store.getState().pendingWrites).toBe(1);

    write.resolve(OK);
    await pending;

    expect(gateway.setCartLineQty).toHaveBeenCalledWith("a", 5, 1_000);
    expect(store.getState().pendingWrites).toBe(0);
  });

  it("rolls the quantity back and posts an error on failure", async () => {
    const store = createCustomerStore(snapshot());
    gateway.setCartLineQty.mockResolvedValueOnce(FAIL);

    await store.getState().setQty("a", 5);

    expect(store.getState().lines[0].qty).toBe(2);
    expect(store.getState().notice?.tone).toBe("error");
  });

  it("treats a quantity of zero as a removal", async () => {
    const store = createCustomerStore(snapshot());

    await store.getState().setQty("a", 0);

    expect(store.getState().lines).toEqual([]);
    expect(gateway.deleteCartLine).toHaveBeenCalledWith("a");
    expect(gateway.setCartLineQty).not.toHaveBeenCalled();
  });

  it("puts a removed line back in its original position on failure", async () => {
    const store = createCustomerStore(snapshot({ lines: [line("a"), line("b"), line("c")] }));
    gateway.deleteCartLine.mockResolvedValueOnce(FAIL);

    await store.getState().removeLine("b");

    expect(store.getState().lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("clears every line with one write and restores them on failure", async () => {
    const store = createCustomerStore(snapshot({ lines: [line("a"), line("b")] }));

    await store.getState().clearCart();
    expect(store.getState().lines).toEqual([]);
    expect(gateway.deleteAllCartLines).toHaveBeenCalledOnce();
    expect(gateway.deleteAllCartLines).toHaveBeenCalledWith("cart-1");

    const failing = createCustomerStore(snapshot({ lines: [line("a"), line("b")] }));
    gateway.deleteAllCartLines.mockResolvedValueOnce(FAIL);
    await failing.getState().clearCart();
    expect(failing.getState().lines.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("hydrate", () => {
  it("takes a fresh server snapshot while no cart write is in flight", () => {
    const store = createCustomerStore(snapshot());

    store.getState().hydrate(snapshot({ cart: null, lines: [], unreadCount: 0, addressLabel: "Work" }));

    expect(store.getState()).toMatchObject({ cart: null, lines: [], unreadCount: 0, addressLabel: "Work" });
  });

  it("does not clobber an optimistic cart with a server snapshot that may predate it", async () => {
    const store = createCustomerStore(snapshot());
    const write = deferred();
    gateway.setCartLineQty.mockReturnValueOnce(write.promise);
    const pending = store.getState().setQty("a", 5);

    store.getState().hydrate(snapshot({ addressLabel: "Work" }));

    expect(store.getState().lines[0].qty).toBe(5);
    expect(store.getState().addressLabel).toBe("Work");
    write.resolve(OK);
    await pending;
  });

  it("resets everything when the user changes", () => {
    const store = createCustomerStore(snapshot());

    store.getState().hydrate(snapshot({ userId: "user-2", cart: null, lines: [], unreadCount: 0 }));

    expect(store.getState()).toMatchObject({ userId: "user-2", cart: null, lines: [], pendingWrites: 0 });
  });
});

describe("plainLineFor", () => {
  it("ignores lines added with options, which never back a stepper", () => {
    const withOptions = {
      ...line("x", 1, "item-1"),
      options_snapshot: [{ optionId: "o", name: "Large", priceDeltaKobo: 0 }],
    };
    const plain = line("y", 1, "item-1");

    expect(plainLineFor([withOptions], "item-1")).toBeUndefined();
    expect(plainLineFor([withOptions, plain], "item-1")).toBe(plain);
  });
});
