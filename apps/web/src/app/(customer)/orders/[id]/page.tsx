// app/(customer)/orders/[id]/page.tsx
import { retryPaymentAction } from "@/app/actions/orders";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapMonnifyPaymentMethod, verifyTransaction } from "@/lib/monnify";
import { formatNaira, koboOf } from "@kiakia/domain";
import type { Json } from "@kiakia/db";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  OrderStatusBadge,
} from "@kiakia/ui";
import type { OrderStatus } from "@kiakia/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderDetailDesktop } from "./_components/OrderDetailDesktop";
import { OrderDetailMobile } from "./_components/OrderDetailMobile";

export const metadata: Metadata = { title: "Order" };

/**
 * The Monnify webhook (supabase/functions/monnify-webhook, a Supabase Edge
 * Function — publicly reachable independent of this Next.js app's own
 * deploy/rollback state) is the source of truth for capturing a payment.
 * But it's still a server-to-server call Monnify makes on its own schedule
 * — it can be delayed, or never configured/reachable in a given
 * environment. This is the fallback half of the same "never rely on one
 * path" discipline: whenever the customer's browser lands back here on a
 * still-unpaid order (Monnify's redirectUrl, or just a manual refresh),
 * re-verify directly against Monnify's API and capture if it's actually
 * paid — same §6.3 rule the webhook already follows ("never trust a
 * webhook payload alone — re-check with the provider directly"), just
 * triggered by the redirect instead of the webhook. capture_payment() is
 * idempotent on payments.status = 'success' (0010_capture_payment.sql), so
 * this can never double-capture even if the webhook lands moments later or
 * earlier.
 */
async function tryCapturePendingPayment(orderId: string, orderCode: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("status, provider, provider_ref")
    .eq("idempotency_key", orderCode)
    .maybeSingle();

  if (!payment || payment.status === "success" || !payment.provider_ref) return false;

  let verified;
  try {
    verified = await verifyTransaction(payment.provider_ref);
  } catch (error) {
    // Monnify unreachable/erroring — leave the order as pending; the retry
    // button and/or a future webhook delivery are still there as fallbacks.
    console.error("tryCapturePendingPayment: verifyTransaction failed", error);
    return false;
  }

  if (verified.paymentStatus !== "PAID" && verified.paymentStatus !== "OVERPAID") return false;

  const { error } = await admin.rpc("capture_payment", {
    p_order_id: orderId,
    p_provider: payment.provider,
    p_provider_ref: verified.transactionReference,
    p_amount_kobo: Math.round(verified.amountPaid * 100), // Monnify's amountPaid is in Naira — see lib/monnify.ts header
    p_raw: verified as unknown as Json,
    p_idempotency_key: orderCode,
    p_channel: mapMonnifyPaymentMethod(verified.paymentMethod),
  });

  if (error) {
    console.error("tryCapturePendingPayment: capture_payment failed", error);
    return false;
  }

  return true;
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const { id } = await params;
  const supabase = await createClient();

  const ORDER_COLUMNS =
    "id, code, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_note, vendor_id";

  let { data: orderRow } = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", id).maybeSingle();

  if (!orderRow) notFound();

  // See tryCapturePendingPayment()'s own comment: this is the redirect-back
  // fallback for the Monnify webhook, which can't reach this app at all in
  // local dev. Only attempted for an order actually still awaiting payment,
  // so a normal already-paid order never pays the extra Monnify round trip.
  if (orderRow.status === "draft" && orderRow.payment_status === "pending") {
    const captured = await tryCapturePendingPayment(orderRow.id, orderRow.code);
    if (captured) {
      const { data: refreshed } = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", id).maybeSingle();
      if (refreshed) orderRow = refreshed;
    }
  }

  // delivery_code lives in its own table now (order_delivery_codes,
  // supabase/migrations/0022_delivery_code_off_orders.sql), RLS-scoped to
  // this order's own customer only — never the assigned rider or vendor
  // staff. For a rider/vendor-staff session that can otherwise read this
  // order row (0007_rls.sql's own "assigned rider reads that order" /
  // "vendor staff read their vendor orders" policies), this query
  // naturally returns no row, so `code` below is undefined for them — that
  // is the fix, not an oversight.
  const [{ data: vendor }, { data: items }, { data: deliveryCodeRow }] = await Promise.all([
    supabase
      .from("vendors")
      .select("name, logo_url")
      .eq("id", orderRow.vendor_id)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id, name_snapshot, qty, line_total_kobo")
      .eq("order_id", orderRow.id),
    supabase.from("order_delivery_codes").select("code").eq("order_id", orderRow.id).maybeSingle(),
  ]);

  const order = { ...orderRow, delivery_code: deliveryCodeRow?.code ?? null };

  // Check if payment is needed
  const needsPayment =
    order.status === "draft" && order.payment_status === "pending";

  // If payment is needed, show the payment retry UI
  if (needsPayment) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-ink-muted">Order {order.code}</p>
            {vendor && (
              <p className="text-sm text-ink-muted">from {vendor.name}</p>
            )}
          </div>
          <OrderStatusBadge status={order.status as OrderStatus} />
        </div>

        <Card className="mt-4">
          <p className="text-sm text-ink">
            Payment wasn&apos;t completed for this order.
          </p>
          <form
            action={retryPaymentAction.bind(null, order.id)}
            className="mt-3"
          >
            <Button type="submit" className="w-full">
              Complete payment →
            </Button>
          </form>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Order Summary</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-1">
              {(items ?? []).map((item) => (
                <li key={item.id} className="flex justify-between">
                  <span>
                    {item.qty}× {item.name_snapshot}
                  </span>
                  <span>{formatNaira(koboOf(item.line_total_kobo))}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatNaira(koboOf(order.subtotal_kobo))}</span>
              </div>
              <div className="flex justify-between">
                <span>Delivery Fee</span>
                <span>{formatNaira(koboOf(order.delivery_fee_kobo))}</span>
              </div>
              <div className="flex justify-between">
                <span>Service Fee</span>
                <span>{formatNaira(koboOf(order.service_fee_kobo))}</span>
              </div>
              {order.discount_kobo > 0 && (
                <div className="flex justify-between text-positive">
                  <span>Discount</span>
                  <span>−{formatNaira(koboOf(order.discount_kobo))}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-semibold text-ink">
                <span>Total</span>
                <span>{formatNaira(koboOf(order.total_kobo))}</span>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // For confirmed orders, show the redesigned layout
  return (
    <>
      <div className="hidden md:block">
        <OrderDetailDesktop order={order} vendor={vendor} items={items ?? []} />
      </div>
      <div className="md:hidden">
        <OrderDetailMobile order={order} vendor={vendor} items={items ?? []} />
      </div>
    </>
  );
}
