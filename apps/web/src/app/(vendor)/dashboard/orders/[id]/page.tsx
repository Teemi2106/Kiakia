import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Card, CardBody, CardHeader, CardTitle, OrderStatusBadge } from "@kiakia/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VendorOrderActions } from "../../../_components/VendorOrderActions";

export const metadata: Metadata = { title: "Order detail" };

export default async function VendorOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, code, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, total_kobo, delivery_address, delivery_note, vendor_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (!order || order.vendor_id !== vendor.id) notFound();

  const { data: items } = await supabase
    .from("order_items")
    .select("id, name_snapshot, qty, options_snapshot, line_total_kobo")
    .eq("order_id", order.id);

  const address = order.delivery_address as { line1?: string; landmark?: string; city?: string; state?: string } | null;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">{order.code}</h1>
        <OrderStatusBadge status={order.status} />
      </div>

      <Card className="mt-4">
        <VendorOrderActions orderId={order.id} status={order.status} />
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="flex flex-col gap-2">
            {(items ?? []).map((item) => (
              <li key={item.id} className="flex justify-between">
                <span>
                  {item.qty}× {item.name_snapshot}
                </span>
                <span>{formatNaira(koboOf(item.line_total_kobo))}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-border pt-3 text-base font-semibold text-ink">
            <span>Total</span>
            <span>{formatNaira(koboOf(order.total_kobo))}</span>
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
            {order.delivery_note && <p className="mt-2 italic">&ldquo;{order.delivery_note}&rdquo;</p>}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
