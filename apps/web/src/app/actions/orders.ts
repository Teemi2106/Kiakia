"use server";

import type { Json, OrderStatus } from "@kiakia/db";
import { normalizeNigerianState } from "@kiakia/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveAccount, requireVendorContext, verifySession } from "@/lib/auth/dal";
import { getActiveRole } from "@/lib/auth/active-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { initializeTransaction } from "@/lib/monnify";
import { serverEnv } from "@/lib/env.server";
import { phoneSchema } from "@/lib/validation/auth";

interface DeliveryAddressJson {
  line1: string;
  landmark: string | null;
  city: string;
  state: string;
}

interface SessionLike {
  readonly userId: string;
  readonly email: string | null;
}

interface OrderForPayment {
  readonly id: string;
  readonly code: string;
  readonly total_kobo: number;
  /** What the wallet already funds (hold_wallet_for_order, 0117). The card pays the rest. */
  readonly wallet_applied_kobo: number;
}

/**
 * Shared by placeOrderAction and retryPaymentAction so the two can't
 * diverge on how a payment gets initialized for an order — the P0 bug this
 * fixes was exactly that divergence: retryPaymentAction called
 * initializeTransaction() and redirected to Monnify checkout but never
 * wrote the `payments` row capture_payment() requires (0010_capture_payment.sql
 * raises "no payment row found" without one), so a customer completing
 * payment on a retry could never actually have it captured.
 *
 * Upserts on `idempotency_key` (order.code, unique on `payments`,
 * 0005_ledger.sql) rather than a plain insert — a retry may be the very
 * first payments row for this order (initial Monnify init failed before
 * placeOrderAction reached the insert) or a second attempt on a row that
 * already exists from an abandoned first checkout; both must resolve to
 * exactly one 'pending' payments row per order, never a duplicate-key
 * error on the second case.
 *
 * S2 (independent security review, two rounds): this used to blindly
 * upsert status: 'pending' with no read-back and no error check first —
 * a TOCTOU race against the Monnify webhook that could revert an
 * already-captured payment back to 'pending'. The read-back added in the
 * first round narrows that window but doesn't close it: initializeTransaction()
 * below is a network round-trip, and a webhook capture landing during it
 * would still slip past the earlier read. The second round makes the
 * *write* itself conditional instead of relying on a prior read: an
 * ignoreDuplicates insert never overwrites an existing row, and the
 * follow-up refresh only touches rows still `status = 'pending'` — so a
 * row the webhook already flipped to 'success' during the round-trip is
 * left alone by the database itself, not by a check that ran too early.
 */
async function initializePaymentForOrder(session: SessionLike, order: OrderForPayment): Promise<string> {
  const supabase = await createClient();
  const admin = createAdminClient();

  // The card only ever pays what the wallet is not already funding. The
  // database re-derives the same figure when the payment is captured, so a
  // wrong number here can only fail or be credited back, never mis-book.
  const cardKobo = order.total_kobo - order.wallet_applied_kobo;
  if (!Number.isSafeInteger(cardKobo) || cardKobo <= 0) {
    throw new Error("This order has nothing left to pay by card.");
  }

  // Two independent reads (the buyer's display name for Monnify, and whether
  // this order was already captured): one wave, not two.
  const [{ data: profile }, { data: existingPayment }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", session.userId).maybeSingle(),
    admin.from("payments").select("status").eq("idempotency_key", order.code).maybeSingle(),
  ]);

  if (existingPayment?.status === "success") {
    // Already captured — most likely the webhook landed between the
    // caller's own status check and this call. Never overwrite it back to
    // 'pending', and never hand back a fresh checkout URL for an order
    // that's already paid.
    throw new Error("This order has already been paid for.");
  }

  // Monnify rejects an empty customerEmail (422) — fail with a clear message
  // before the network round-trip rather than after it.
  if (!session.email) {
    throw new Error("Add an email address to your account before paying by card.");
  }

  const transaction = await initializeTransaction({
    amountKobo: cardKobo,
    paymentReference: order.code,
    paymentDescription: `KiaKia order ${order.code}`,
    customerName: profile?.full_name ?? "KiaKia Customer",
    customerEmail: session.email,
    redirectUrl: `${serverEnv.MONNIFY_REDIRECT_BASE_URL ?? serverEnv.NEXT_PUBLIC_SITE_URL}/orders/${order.id}`,
  });

  // Never overwrite a row the webhook already captured while the Monnify
  // round-trip above was in flight: an ignoreDuplicates insert leaves any
  // existing row untouched, and the refresh below only matches rows still
  // `status = 'pending'` — so a row that's now 'success' is left alone by
  // the WHERE clause itself, not by a check that ran before the race window.
  const { error: insertError } = await admin.from("payments").upsert(
    {
      order_id: order.id,
      provider: "monnify",
      provider_ref: transaction.transactionReference,
      amount_kobo: cardKobo,
      status: "pending",
      idempotency_key: order.code,
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true },
  );

  if (insertError) {
    throw new Error("We couldn't prepare your payment. Please try again.");
  }

  const { error: refreshError } = await admin
    .from("payments")
    .update({
      provider_ref: transaction.transactionReference,
      amount_kobo: cardKobo,
    })
    .eq("idempotency_key", order.code)
    .eq("status", "pending");

  if (refreshError) {
    throw new Error("We couldn't prepare your payment. Please try again.");
  }

  return transaction.checkoutUrl;
}

/**
 * placeOrderAction: the one Server Action that turns a cart into a paid
 * order. Two privileged steps chained together —
 *   1. place_order() RPC (user-scoped client; re-derives every price
 *      server-side, §12) creates the draft order.
 *   2. Monnify init-transaction + a 'pending' payments row (admin client —
 *      payments writes are revoked from `authenticated`, 0007_rls.sql), via
 *      initializePaymentForOrder() above.
 * If Monnify's init call fails after the order exists, the order is left
 * in draft/pending — the order detail page's "Complete payment" retry
 * (retryPaymentAction below) can pick it back up.
 */

export interface CheckoutFormState {
  readonly error?: string;
}

export async function placeOrderAction(
  _prevState: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const session = await verifySession();

  // Mirror of requireVendorContext()'s gate on the vendor side: this is a
  // customer money-moving action, reachable by direct POST regardless of
  // which layout rendered the form that normally leads here — a session
  // actively in vendor mode must not be able to place an order as if it
  // were the customer surface. See lib/auth/active-role.ts and the
  // (customer) layout's own mirror check.
  if ((await getActiveRole()) === "vendor") {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  // Required so the rider assigned to this order can actually reach the
  // customer — get_rider_offer_details() (extended by
  // 0072_rider_offer_details_customer_contact.sql) reads it straight off
  // profiles.phone, the same field registration collects (0070 fixed a
  // regression that had silently left this null for every existing
  // signup - see that migration's header). Normalized/validated with the
  // exact same phoneSchema registration itself uses, so a number entered
  // here and one entered at signup always end up in the same stored shape.
  const contactPhoneRaw = (formData.get("contactPhone") as string | null) ?? "";
  const contactPhoneResult = phoneSchema.safeParse(contactPhoneRaw);
  if (!contactPhoneResult.success) {
    return { error: "Enter a valid phone number so your rider can reach you." };
  }
  const contactPhone = contactPhoneResult.data;

  const deliveryNote = (formData.get("deliveryNote") as string | null) || null;
  const savedAddressId = formData.get("addressId") as string | null;

  // One wave of reads, with the account-status gate riding in it: the gate
  // (requireActiveAccount, a profiles read) and the data this action needs
  // (current phone, the chosen saved address, the open cart) do not depend on
  // each other. Nothing is WRITTEN until the gate has passed: if it redirects,
  // Promise.all rejects and every write below is skipped.
  const [, { data: currentProfile }, savedAddress, { data: cart }] = await Promise.all([
    requireActiveAccount(),
    supabase.from("profiles").select("phone").eq("id", session.userId).maybeSingle(),
    savedAddressId
      ? supabase
          .from("addresses")
          .select("line1, landmark, city, state, location")
          .eq("id", savedAddressId)
          .eq("customer_id", session.userId)
          .maybeSingle()
      : Promise.resolve(null),
    supabase.from("carts").select("id").eq("customer_id", session.userId).eq("status", "open").maybeSingle(),
  ]);

  let deliveryLocationWkt: string;
  let deliveryAddress: DeliveryAddressJson;
  // Writes that do not feed place_order(): run beside it, not before it.
  const sideWrites: PromiseLike<unknown>[] = [];

  // Saved for subsequent orders — only writes when it actually changed, so
  // this never touches updated_at (and any trigger keyed off it) on every
  // single checkout. "update own profile" (0007_rls.sql) permits this: the
  // authenticated customer updating their own row.
  if (currentProfile?.phone !== contactPhone) {
    sideWrites.push(supabase.from("profiles").update({ phone: contactPhone }).eq("id", session.userId));
  }

  if (savedAddressId) {
    const address = savedAddress?.data;

    if (!address) {
      await Promise.all(sideWrites);
      return { error: "That address could not be found. Please choose or add another." };
    }

    deliveryLocationWkt = address.location;
    deliveryAddress = {
      line1: address.line1,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
    };
  } else {
    const line1 = formData.get("line1") as string | null;
    const city = (formData.get("city") as string | null) || "Abuja";
    const state = normalizeNigerianState(formData.get("state") as string | null) ?? "FCT";
    const landmark = (formData.get("landmark") as string | null) || null;
    const lat = formData.get("lat") as string | null;
    const lng = formData.get("lng") as string | null;

    if (!line1 || !lat || !lng) {
      await Promise.all(sideWrites);
      return { error: "Add a delivery address, or share your location, before checking out." };
    }

    deliveryLocationWkt = `POINT(${lng} ${lat})`;
    deliveryAddress = { line1, landmark, city, state };

    const shouldSave = formData.get("saveAddress") === "on";
    if (shouldSave) {
      sideWrites.push(
        supabase.from("addresses").insert({
          customer_id: session.userId,
          label: (formData.get("label") as string | null) || "Home",
          line1,
          landmark,
          city,
          state,
          location: deliveryLocationWkt,
        }),
      );
    }
  }

  if (!cart) {
    await Promise.all(sideWrites);
    return { error: "Your cart is empty." };
  }

  const [{ data: order, error: placeError }] = await Promise.all([
    supabase.rpc("place_order", {
      p_cart_id: cart.id,
      p_delivery_address: deliveryAddress as unknown as Json,
      p_delivery_location: deliveryLocationWkt,
      p_delivery_note: deliveryNote,
    }),
    ...sideWrites,
  ]);

  if (placeError || !order) {
    if (placeError?.message.includes("outside every active service area")) {
      return { error: "Sorry, that address is outside our delivery area right now." };
    }
    if (placeError?.message.includes("delivery radius")) {
      return { error: "This kitchen does not deliver that far. Try another address or a closer kitchen." };
    }
    return { error: "We couldn't place your order. Please try again." };
  }

  // Wallet checkout never touches Monnify: pay_order_from_wallet()
  // (0045_customer_wallet.sql) moves the total straight from the customer's
  // wallet into escrow and takes the order draft -> placed, so there is no
  // provider redirect to send them through. The RPC re-derives the caller,
  // the amount and the balance server-side, so a tampered form field can
  // only ever fail this call, never overspend a wallet.
  if (formData.get("paymentMethod") === "wallet") {
    const { error: walletError } = await supabase.rpc("pay_order_from_wallet", {
      p_order_id: order.id,
    });

    if (walletError) {
      // The order is already placed as a draft, so this is recoverable
      // rather than fatal — the order's own page offers a card retry.
      console.error("pay_order_from_wallet failed", walletError);
      return {
        error: walletError.message.includes("does not cover")
          ? "Your wallet balance no longer covers this order. Pay by card instead."
          : "We couldn't pay for this order from your wallet. Please try again, or pay by card.",
      };
    }

    redirect(`/orders/${order.id}`);
  }

  // Split payment (0117): "use my wallet" puts whatever the wallet holds
  // towards the order and the card pays the rest. hold_wallet_for_order()
  // derives the amount itself from the ledger under a lock; nothing the
  // browser sends decides it. If it cannot hold anything, the customer is sent
  // to the order page to choose, never silently charged the full card amount
  // they were expecting to part-pay.
  let walletHeldKobo = 0;
  if (formData.get("useWallet") === "1") {
    const { data: held, error: holdError } = await supabase.rpc("hold_wallet_for_order", { p_order_id: order.id });
    if (holdError || typeof held !== "number" || held <= 0) {
      if (holdError) console.error("hold_wallet_for_order failed", holdError);
      redirect(`/orders/${order.id}`);
    }
    walletHeldKobo = held;
  }

  let checkoutUrl: string;
  try {
    checkoutUrl = await initializePaymentForOrder(session, { ...order, wallet_applied_kobo: walletHeldKobo });
  } catch (error) {
    console.error("Monnify init-transaction failed", error);
    // The order exists (draft, unpaid) — send the customer to its detail
    // page rather than a dead end; that page offers a retry. Any wallet hold
    // stays reserved for them there, and is returned automatically after 30
    // minutes if they walk away.
    redirect(`/orders/${order.id}`);
  }

  redirect(checkoutUrl);
}

/**
 * Re-runs the Monnify init step for an existing draft order — the "Complete
 * payment" retry on the order detail page, for when the first attempt
 * failed after place_order() already succeeded, or was simply abandoned
 * before the customer completed checkout. Bound to a form's `action` via
 * `retryPaymentAction.bind(null, order.id)`, which requires a
 * `Promise<void>` return — failures throw instead of returning an error
 * state, surfaced by the (customer) route group's error.tsx boundary. Both
 * failure cases here are edge cases the button shouldn't normally allow
 * reaching (the page that renders it already checked status/payment_status
 * moments earlier), not everyday user errors that need inline messaging.
 *
 * Uses initializePaymentForOrder() (shared with placeOrderAction) so this
 * writes the same 'pending' payments row placeOrderAction would have —
 * previously this action redirected to Monnify checkout without ever
 * writing one, so a completed retry payment could never be captured (the
 * webhook's capture_payment() raises "no payment row found" forever).
 */
export async function retryPaymentAction(orderId: string): Promise<void> {
  const session = await verifySession();
  await requireActiveAccount();

  // Mirror of the same active-role gate as placeOrderAction — see there.
  if ((await getActiveRole()) === "vendor") {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, code, total_kobo, wallet_applied_kobo, customer_id, status, payment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.customer_id !== session.userId) {
    throw new Error("Order not found.");
  }
  if (order.status !== "draft" || order.payment_status !== "pending") {
    throw new Error("This order has already been paid for.");
  }

  const checkoutUrl = await initializePaymentForOrder(session, order);

  redirect(checkoutUrl);
}

/**
 * "Pay the full amount by card instead": returns any wallet money held for this
 * unpaid order to the wallet, then sends the customer back to the order page,
 * where "Complete payment" now charges the whole total. The RPC refuses once
 * the order is paid, so this can never hand back money an order is using.
 */
export async function releaseWalletHoldAction(orderId: string): Promise<void> {
  const session = await verifySession();

  if ((await getActiveRole()) === "vendor") {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, customer_id, status, payment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.customer_id !== session.userId) {
    throw new Error("Order not found.");
  }
  if (order.status !== "draft" || order.payment_status !== "pending") {
    throw new Error("This order has already been paid for.");
  }

  const { error } = await supabase.rpc("release_wallet_hold", { p_order_id: order.id });
  if (error) {
    console.error("release_wallet_hold failed", error);
    throw new Error("We couldn't return your wallet money. Please try again.");
  }

  revalidatePath(`/orders/${order.id}`);
  redirect(`/orders/${order.id}`);
}

/**
 * The other way out of a "payment wasn't completed" draft order (see
 * orders/[id]/page.tsx's needsPayment branch, alongside retryPaymentAction):
 * copy this order's items back into a fresh open cart instead of paying for
 * it. place_order() marks the source cart 'converted' the instant checkout
 * starts (0022_delivery_code_off_orders.sql), before Monnify is ever
 * contacted — necessary so pricing is locked server-side rather than
 * re-derived from a cart that could still change under the customer, but it
 * means a customer who cancels or abandons payment has no cart left at all,
 * only this stranded draft order. This rebuilds one from order_items, which
 * carries everything cart_items needs (menu_item_id, options_snapshot,
 * line_total_kobo) because place_order() copied it from there in the first
 * place.
 *
 * Deliberately does not cancel or otherwise touch the draft order itself —
 * the order state machine has no draft -> cancelled edge (draft only ever
 * advances to placed, packages/domain/src/order-state-machine.ts), and
 * adding one is a real change to a security-reviewed core RPC, not a
 * one-line fix. Left alone, the draft order is inert: no money moved, no
 * vendor was ever notified, and its own "Complete payment" link still works
 * if the customer navigates back to it — which would create a second,
 * independent Monnify transaction for a second, independent order, not a
 * double-charge on this one. The one thing this actively avoids is losing
 * the customer's selections; it does not need to also erase the abandoned
 * order to do that.
 */
export async function restoreCartFromOrderAction(orderId: string): Promise<void> {
  const session = await verifySession();

  if ((await getActiveRole()) === "vendor") {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, vendor_id, customer_id, status, payment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.customer_id !== session.userId) {
    throw new Error("Order not found.");
  }
  if (order.status !== "draft" || order.payment_status !== "pending") {
    throw new Error("This order has already been paid for.");
  }

  // Abandoning the order: give any wallet money held for it back now rather
  // than make the customer wait for the 30 minute sweep. A failure here is not
  // fatal - the sweep returns it anyway.
  const { error: releaseError } = await supabase.rpc("release_wallet_hold", { p_order_id: order.id });
  if (releaseError) console.error("release_wallet_hold failed", releaseError);

  const { data: existingCart } = await supabase
    .from("carts")
    .select("id, vendor_id")
    .eq("customer_id", session.userId)
    .eq("status", "open")
    .maybeSingle();

  let cartId: string;
  if (existingCart && existingCart.vendor_id === order.vendor_id) {
    // Already have an open cart for the same vendor (the customer started
    // browsing again after abandoning this order) — add to that one rather
    // than fragmenting it across two carts for the same restaurant.
    cartId = existingCart.id;
  } else {
    if (existingCart) {
      // An open cart for a *different* vendor. This action was reached from
      // a page dedicated to this specific draft order, so restoring it is
      // the explicit, deliberate choice here — matching addToCart()'s own
      // single-vendor-cart rule, just without a confirm() dialog a Server
      // Action can't show.
      await supabase.from("carts").update({ status: "abandoned" }).eq("id", existingCart.id);
    }
    const { data: newCart, error } = await supabase
      .from("carts")
      .insert({ customer_id: session.userId, vendor_id: order.vendor_id, status: "open" })
      .select("id")
      .single();
    if (error || !newCart) {
      throw new Error("Could not restore your cart.");
    }
    cartId = newCart.id;
  }

  const { data: orderItems } = await supabase
    .from("order_items")
    .select("menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo")
    .eq("order_id", order.id);

  if (orderItems && orderItems.length > 0) {
    const { error } = await supabase.from("cart_items").insert(
      orderItems.map((item) => ({
        cart_id: cartId,
        menu_item_id: item.menu_item_id,
        name_snapshot: item.name_snapshot,
        unit_price_kobo: item.unit_price_kobo,
        qty: item.qty,
        options_snapshot: item.options_snapshot,
        line_total_kobo: item.line_total_kobo,
      })),
    );

    if (error) {
      throw new Error("Could not restore your cart items.");
    }
  }

  redirect("/cart");
}


/**
 * Vendor-side status advance (accept/reject/preparing/ready_for_pickup) —
 * a thin wrapper around the transition_order() RPC, which already IS the
 * authorization + state-machine boundary (checks the caller is vendor_staff
 * on this order's vendor, validates the transition against
 * order_status_transitions, §10). Bound to a form action via
 * `advanceOrderAction.bind(null, orderId, toStatus)`, so this returns
 * `Promise<void>` — errors throw, surfaced by the (vendor) error.tsx
 * boundary, same reasoning as retryPaymentAction above.
 */
export async function advanceOrderAction(orderId: string, toStatus: OrderStatus): Promise<void> {
  // requireVendorContext(), not requireRole(VENDOR_ROLES) — holding a
  // vendor role is necessary but not sufficient; the session must also
  // have explicitly switched into vendor mode (switchToVendorAction). This
  // is a Server Action reachable by direct POST regardless of which layout
  // rendered the button that normally calls it. See lib/auth/dal.ts.
  const session = await requireVendorContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("transition_order", {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_actor_type: "vendor",
    p_actor_id: session.userId,
  });

  if (error) {
    throw new Error(error.message);
  }

  // No Monnify call here any more. transition_order()'s automatic unwind
  // (0041, retargeted by 0045_customer_wallet.sql) now credits the
  // customer's wallet instead of platform:gateway, so the money never left
  // KiaKia and there is nothing to ask the provider to send back — the
  // refund is complete the moment that transition commits. A customer who
  // specifically wants it back on their card goes through
  // refundOrderEscrowAction with destination "gateway", which still does.

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);
}
