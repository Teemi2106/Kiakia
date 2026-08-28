"use server";

import type { Json, OrderStatus } from "@kiakia/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorContext, verifySession } from "@/lib/auth/dal";
import { getActiveRole } from "@/lib/auth/active-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { initializeTransaction } from "@/lib/monnify";
import { serverEnv } from "@/lib/env.server";

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
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", session.userId).maybeSingle();

  const admin = createAdminClient();

  const { data: existingPayment } = await admin
    .from("payments")
    .select("status")
    .eq("idempotency_key", order.code)
    .maybeSingle();

  if (existingPayment?.status === "success") {
    // Already captured — most likely the webhook landed between the
    // caller's own status check and this call. Never overwrite it back to
    // 'pending', and never hand back a fresh checkout URL for an order
    // that's already paid.
    throw new Error("This order has already been paid for.");
  }

  const transaction = await initializeTransaction({
    amountKobo: order.total_kobo,
    paymentReference: order.code,
    paymentDescription: `KiaKia order ${order.code}`,
    customerName: profile?.full_name ?? "KiaKia Customer",
    customerEmail: session.email ?? "",
    redirectUrl: `${serverEnv.NEXT_PUBLIC_SITE_URL}/orders/${order.id}`,
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
      amount_kobo: order.total_kobo,
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
      amount_kobo: order.total_kobo,
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

  const deliveryNote = (formData.get("deliveryNote") as string | null) || null;
  const savedAddressId = formData.get("addressId") as string | null;

  let deliveryLocationWkt: string;
  let deliveryAddress: DeliveryAddressJson;

  if (savedAddressId) {
    const { data: address } = await supabase
      .from("addresses")
      .select("line1, landmark, city, state, location")
      .eq("id", savedAddressId)
      .eq("customer_id", session.userId)
      .maybeSingle();

    if (!address) {
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
    const state = (formData.get("state") as string | null) || "FCT";
    const landmark = (formData.get("landmark") as string | null) || null;
    const lat = formData.get("lat") as string | null;
    const lng = formData.get("lng") as string | null;

    if (!line1 || !lat || !lng) {
      return { error: "Add a delivery address, or share your location, before checking out." };
    }

    deliveryLocationWkt = `POINT(${lng} ${lat})`;
    deliveryAddress = { line1, landmark, city, state };

    const shouldSave = formData.get("saveAddress") === "on";
    if (shouldSave) {
      await supabase.from("addresses").insert({
        customer_id: session.userId,
        label: (formData.get("label") as string | null) || "Home",
        line1,
        landmark,
        city,
        state,
        location: deliveryLocationWkt,
      });
    }
  }

  const { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", session.userId)
    .eq("status", "open")
    .maybeSingle();

  if (!cart) {
    return { error: "Your cart is empty." };
  }

  const { data: order, error: placeError } = await supabase.rpc("place_order", {
    p_cart_id: cart.id,
    p_delivery_address: deliveryAddress as unknown as Json,
    p_delivery_location: deliveryLocationWkt,
    p_delivery_note: deliveryNote,
  });

  if (placeError || !order) {
    if (placeError?.message.includes("outside every active service area")) {
      return { error: "Sorry, that address is outside our delivery area right now." };
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

  let checkoutUrl: string;
  try {
    checkoutUrl = await initializePaymentForOrder(session, order);
  } catch (error) {
    console.error("Monnify init-transaction failed", error);
    // The order exists (draft, unpaid) — send the customer to its detail
    // page rather than a dead end; that page offers a retry.
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

  // Mirror of the same active-role gate as placeOrderAction — see there.
  if ((await getActiveRole()) === "vendor") {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, code, total_kobo, customer_id, status, payment_status")
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
