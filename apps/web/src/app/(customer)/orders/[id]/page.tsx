import { retryPaymentAction } from "@/app/actions/orders";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Button, Card, CardBody, CardHeader, CardTitle, OrderStatusBadge } from "@kiakia/ui";
import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Order" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await verifySession(); // auth gate only — RLS already scopes the query below to rows this session can see
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, code, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_note, delivery_code, vendor_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  const [{ data: vendor }, { data: items }] = await Promise.all([
    supabase.from("vendors").select("name").eq("id", order.vendor_id).maybeSingle(),
    supabase.from("order_items").select("id, name_snapshot, qty, line_total_kobo").eq("order_id", order.id),
  ]);

  const needsPayment = order.status === "draft" && order.payment_status === "pending";
  const address = order.delivery_address as { line1?: string; landmark?: string; city?: string; state?: string } | null;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      {order.status !== "draft" && (
        <div className="mb-4 flex flex-col items-center gap-2 text-center">
          <CheckCircle2 className="size-10 text-positive" />
          <h1 className="text-xl font-semibold text-ink">Order Confirmed!</h1>
          <p className="text-sm text-ink-muted">
            {vendor?.name} is preparing your order.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-muted">Order {order.code}</p>
          {vendor && <p className="text-sm text-ink-muted">from {vendor.name}</p>}
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {order.delivery_code && order.status !== "draft" && (
        <Card className="mt-4 text-center">
          <p className="text-xs font-medium text-danger">Don&apos;t share this code until your order is delivered</p>
          <p className="mt-2 text-sm text-ink-muted">Delivery Code</p>
          <div className="mt-2 flex justify-center gap-2">
            {order.delivery_code.split("").map((digit, i) => (
              <span
                key={i}
                className="flex size-12 items-center justify-center rounded-control border border-border bg-surface text-xl font-semibold text-ink"
              >
                {digit}
              </span>
            ))}
          </div>
        </Card>
      )}

      {needsPayment && (
        <Card className="mt-4">
          <p className="text-sm text-ink">Payment wasn&apos;t completed for this order.</p>
          <form action={retryPaymentAction.bind(null, order.id)} className="mt-3">
            <Button type="submit" className="w-full">
              Complete payment →
            </Button>
          </form>
        </Card>
      )}

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

      {address?.line1 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Delivery Address</CardTitle>
          </CardHeader>
          <CardBody>
            <p>
              {address.line1}
              {address.landmark ? `, near ${address.landmark}` : ""}
            </p>
            <p>
              {address.city}, {address.state}
            </p>
            {order.delivery_note && <p className="mt-1 italic">&ldquo;{order.delivery_note}&rdquo;</p>}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
