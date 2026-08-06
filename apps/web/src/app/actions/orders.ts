"use server";

import type { Json, OrderStatus } from "@kiakia/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, verifySession } from "@/lib/auth/dal";
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

/**
 * placeOrderAction: the one Server Action that turns a cart into a paid
 * order. Two privileged steps chained together —
 *   1. place_order() RPC (user-scoped client; re-derives every price
 *      server-side, §12) creates the draft order.
 *   2. Monnify init-transaction + a 'pending' payments row (admin client —
 *      payments writes are revoked from `authenticated`, 0007_rls.sql).
 * If Monnify's init call fails after the order exists, the order is left
 * in draft/pending — the order detail page's "Complete payment" retry
 * (not built as a separate action; same code path) can pick it back up.
 */

export interface CheckoutFormState {
  readonly error?: string;
}

export async function placeOrderAction(
  _prevState: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const session = await verifySession();
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

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", session.userId).maybeSingle();

  let checkoutUrl: string;
  try {
    const transaction = await initializeTransaction({
      amountKobo: order.total_kobo,
      paymentReference: order.code,
      paymentDescription: `KiaKia order ${order.code}`,
      customerName: profile?.full_name ?? "KiaKia Customer",
      customerEmail: session.email ?? "",
      redirectUrl: `${serverEnv.NEXT_PUBLIC_SITE_URL}/orders/${order.id}`,
    });
    checkoutUrl = transaction.checkoutUrl;

    const admin = createAdminClient();
    await admin.from("payments").insert({
      order_id: order.id,
      provider: "monnify",
      provider_ref: transaction.transactionReference,
      amount_kobo: order.total_kobo,
      status: "pending",
      idempotency_key: order.code,
    });
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
 * failed after place_order() already succeeded. Bound to a form's `action`
 * via `retryPaymentAction.bind(null, order.id)`, which requires a
 * `Promise<void>` return — failures throw instead of returning an error
 * state, surfaced by the (customer) route group's error.tsx boundary. Both
 * failure cases here are edge cases the button shouldn't normally allow
 * reaching (the page that renders it already checked status/payment_status
 * moments earlier), not everyday user errors that need inline messaging.
 */
export async function retryPaymentAction(orderId: string): Promise<void> {
  const session = await verifySession();
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

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", session.userId).maybeSingle();

  const transaction = await initializeTransaction({
    amountKobo: order.total_kobo,
    paymentReference: order.code,
    paymentDescription: `KiaKia order ${order.code}`,
    customerName: profile?.full_name ?? "KiaKia Customer",
    customerEmail: session.email ?? "",
    redirectUrl: `${serverEnv.NEXT_PUBLIC_SITE_URL}/orders/${order.id}`,
  });

  redirect(transaction.checkoutUrl);
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
  const session = await requireRole(["vendor_staff", "vendor_manager", "vendor_owner"]);
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

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);
}
