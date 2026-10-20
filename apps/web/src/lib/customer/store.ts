import { MAX_CART_ITEM_QTY } from "@kiakia/domain";
import { createStore } from "zustand/vanilla";
import {
  abandonCart,
  createCart,
  deleteAllCartLines,
  deleteCartLine,
  insertCartLine,
  setCartLineQty,
  type CartLineItem,
  type CartOptionSelection,
  type CartResult,
} from "@/lib/cart";
import type { CartMeta, CustomerSnapshot } from "./types";
import { uuidv7 } from "./uuid";

export interface AddToCartInput {
  readonly vendorId: string;
  readonly vendorName: string;
  readonly menuItemId: string;
  readonly name: string;
  /** Base price + selected options — display/snapshot only, re-derived server-side at checkout. */
  readonly unitPriceKobo: number;
  readonly qty: number;
  readonly options: readonly CartOptionSelection[];
  readonly imageUrl?: string | null;
}

export interface Notice {
  readonly id: number;
  readonly text: string;
  readonly tone: "success" | "error";
}

export interface CustomerState {
  userId: string;
  cart: CartMeta | null;
  lines: readonly CartLineItem[];
  unreadCount: number;
  addressLabel: string | null;
  notice: Notice | null;
  cartOpen: boolean;
  /** Cart writes sent and not yet answered; while any are out, a server snapshot must not overwrite the cart. */
  pendingWrites: number;

  hydrate: (snapshot: CustomerSnapshot) => void;
  notify: (text: string, tone: Notice["tone"]) => void;
  dismissNotice: () => void;
  setCartOpen: (open: boolean) => void;
  setUnreadCount: (count: number | ((current: number) => number)) => void;
  /** Resolves true when the item went into the cart (the write itself may still be in flight). */
  addToCart: (input: AddToCartInput, confirmSwitch?: (itemName: string) => boolean) => Promise<boolean>;
  setQty: (lineId: string, qty: number) => Promise<void>;
  removeLine: (lineId: string) => Promise<void>;
  clearCart: () => Promise<void>;
}

const NO_LINES: readonly CartLineItem[] = [];

export const selectItemCount = (state: CustomerState): number =>
  state.lines.reduce((sum, line) => sum + line.qty, 0);

/** The one line for a no-option menu item. An item added with options may not
 * be the configuration a bare "+" tap would produce, so those lines never
 * back a stepper — see VendorMenu. */
export function plainLineFor(lines: readonly CartLineItem[], menuItemId: string): CartLineItem | undefined {
  return lines.find(
    (line) =>
      line.menu_item_id === menuItemId &&
      !(Array.isArray(line.options_snapshot) && line.options_snapshot.length > 0),
  );
}

function qtyError(qty: number): string | null {
  return Number.isInteger(qty) && qty >= 1 && qty <= MAX_CART_ITEM_QTY
    ? null
    : `You can order between 1 and ${MAX_CART_ITEM_QTY} of one item.`;
}

function confirmInBrowser(itemName: string): boolean {
  return window.confirm(
    `Your cart has items from another restaurant. Clear it and start a new order with ${itemName}?`,
  );
}

function withQty(line: CartLineItem, qty: number): CartLineItem {
  return { ...line, qty, line_total_kobo: line.unit_price_kobo * qty };
}

/**
 * The customer surface's one client store: identity, cart, unread count and
 * default address, seeded from the layout's server read instead of fetched
 * per component. Built per layout mount (see CustomerStoreProvider), never a
 * module singleton, because on the server a singleton would be shared by
 * every request.
 *
 * Cart mutations are optimistic. Each one updates state at once, sends one
 * write through RLS (lib/cart.ts), and on failure undoes just its own change
 * and posts a notice. Writes run through a single queue so they reach the
 * database in tap order (create cart, then insert line, then change qty).
 * Ids for new carts and lines are minted here, so a freshly added line is
 * already editable before its insert returns. Money is display-only:
 * place_order() re-derives every price.
 */
export function createCustomerStore(initial: CustomerSnapshot) {
  let queue: Promise<unknown> = Promise.resolve();
  let noticeSeq = 0;

  return createStore<CustomerState>()((set, get) => {
    function enqueue(write: () => Promise<CartResult>): Promise<CartResult> {
      set((s) => ({ pendingWrites: s.pendingWrites + 1 }));
      const run = queue.then(write).finally(() => set((s) => ({ pendingWrites: s.pendingWrites - 1 })));
      queue = run.catch(() => undefined);
      return run;
    }

    function report(result: CartResult) {
      if (!result.ok) get().notify(result.error, "error");
    }

    return {
      userId: initial.userId,
      cart: initial.cart,
      lines: initial.lines,
      unreadCount: initial.unreadCount,
      addressLabel: initial.addressLabel,
      notice: null,
      cartOpen: false,
      pendingWrites: 0,

      hydrate(snapshot) {
        if (snapshot.userId !== get().userId) {
          set({ ...snapshot, notice: null, pendingWrites: 0 });
          return;
        }
        // A server render that raced a local write may predate it, so the
        // cart (the only slice written locally) is taken only while idle.
        const idle = get().pendingWrites === 0;
        set({
          addressLabel: snapshot.addressLabel,
          unreadCount: snapshot.unreadCount,
          ...(idle ? { cart: snapshot.cart, lines: snapshot.lines } : {}),
        });
      },

      notify(text, tone) {
        set({ notice: { id: ++noticeSeq, text, tone } });
      },
      dismissNotice: () => set({ notice: null }),
      setCartOpen: (cartOpen) => set({ cartOpen }),
      setUnreadCount: (count) =>
        set((s) => ({ unreadCount: typeof count === "function" ? count(s.unreadCount) : count })),

      async addToCart(input, confirmSwitch = confirmInBrowser) {
        const error = qtyError(input.qty);
        if (error) {
          get().notify(error, "error");
          return false;
        }

        const { userId, cart, lines } = get();
        const switching = cart !== null && cart.vendorId !== input.vendorId;
        if (switching && lines.length > 0 && !confirmSwitch(input.name)) return false;

        const startsCart = switching || cart === null;
        const next: CartMeta = startsCart
          ? { id: crypto.randomUUID(), vendorId: input.vendorId, vendorName: input.vendorName }
          : cart;
        const line: CartLineItem = {
          id: uuidv7(),
          menu_item_id: input.menuItemId,
          menu_item_image_url: input.imageUrl ?? null,
          name_snapshot: input.name,
          unit_price_kobo: input.unitPriceKobo,
          qty: input.qty,
          options_snapshot: input.options.map((o) => ({
            optionId: o.optionId,
            name: o.name,
            priceDeltaKobo: o.priceDeltaKobo,
          })),
          line_total_kobo: input.unitPriceKobo * input.qty,
        };

        set({ cart: next, lines: switching ? [line] : [...lines, line] });

        let abandonedPrevious = false;
        const result = await enqueue(async () => {
          if (switching) {
            const abandoned = await abandonCart(cart.id);
            if (!abandoned.ok) return abandoned;
            abandonedPrevious = true;
          }
          if (startsCart) {
            const created = await createCart(next.id, userId, input.vendorId);
            if (!created.ok) return created;
          }
          return insertCartLine(next.id, line);
        });

        if (!result.ok) {
          if (switching) {
            // Once the old cart is abandoned in the database there is nothing to go back to.
            set(abandonedPrevious ? { cart: null, lines: NO_LINES } : { cart, lines });
          } else {
            set((s) => {
              const remaining = s.lines.filter((l) => l.id !== line.id);
              return { lines: remaining, cart: startsCart && remaining.length === 0 ? null : s.cart };
            });
          }
          report(result);
        }
        return result.ok;
      },

      async setQty(lineId, qty) {
        const line = get().lines.find((l) => l.id === lineId);
        if (!line) return;
        if (qty <= 0) return get().removeLine(lineId);

        const error = qtyError(qty);
        if (error) {
          get().notify(error, "error");
          return;
        }

        const apply = (to: number) =>
          set((s) => ({ lines: s.lines.map((l) => (l.id === lineId ? withQty(l, to) : l)) }));
        apply(qty);

        const result = await enqueue(() => setCartLineQty(lineId, qty, line.unit_price_kobo));
        if (!result.ok) {
          apply(line.qty);
          report(result);
        }
      },

      async removeLine(lineId) {
        const { lines } = get();
        const index = lines.findIndex((l) => l.id === lineId);
        if (index === -1) return;
        const line = lines[index];

        set({ lines: lines.filter((l) => l.id !== lineId) });

        const result = await enqueue(() => deleteCartLine(lineId));
        if (!result.ok) {
          set((s) => ({ lines: [...s.lines.slice(0, index), line, ...s.lines.slice(index)] }));
          report(result);
        }
      },

      async clearCart() {
        const { cart, lines } = get();
        if (!cart || lines.length === 0) return;

        set({ lines: NO_LINES });

        const result = await enqueue(() => deleteAllCartLines(cart.id));
        if (!result.ok) {
          set((s) => ({ lines: [...lines, ...s.lines] }));
          report(result);
        }
      },
    };
  });
}

export type CustomerStore = ReturnType<typeof createCustomerStore>;
