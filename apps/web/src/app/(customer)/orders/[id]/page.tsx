// app/(customer)/orders/[id]/page.tsx
//DUMMY DATA FOR TESTING DON'T FORGET TO REMOVE AND ADD SUPABSE CODE
import { retryPaymentAction } from "@/app/actions/orders";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  OrderStatusBadge,
} from "@kiakia/ui";
import { CheckCircle2 } from "lucide-react";
import type { OrderStatus } from "@kiakia/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderDetailDesktop } from "./_components/OrderDetailDesktop";
import { OrderDetailMobile } from "./_components/OrderDetailMobile";

export const metadata: Metadata = { title: "Order" };

// Dummy data for testing
const DUMMY_ORDER = {
  id: "order-1",
  code: "ORD-2024-001",
  status: "preparing",
  payment_status: "paid",
  subtotal_kobo: 1250000,
  delivery_fee_kobo: 50000,
  service_fee_kobo: 25000,
  discount_kobo: 10000,
  total_kobo: 1315000,
  delivery_address: {
    line1: "123 Main Street",
    landmark: "Near the mall",
    city: "Lagos",
    state: "Lagos",
  },
  delivery_note: "Please call when you arrive",
  delivery_code: "4091",
  vendor_id: "vendor-1",
};

const DUMMY_VENDOR = { name: "Mama Cass" };

const DUMMY_ITEMS = [
  {
    id: "item-1",
    name_snapshot: "Special Jollof Rice Combo",
    qty: 2,
    line_total_kobo: 500000,
  },
  {
    id: "item-2",
    name_snapshot: "Extra Plantain",
    qty: 1,
    line_total_kobo: 100000,
  },
  {
    id: "item-3",
    name_snapshot: "Chilled Malt Drink",
    qty: 1,
    line_total_kobo: 150000,
  },
];

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const { id } = await params;

  // Use dummy data for testing
  const useDummyData = true; // Set to false for real data

  let order = null;
  let vendor = null;
  let items = [];

  if (useDummyData) {
    order = DUMMY_ORDER;
    vendor = DUMMY_VENDOR;
    items = DUMMY_ITEMS;
  } else {
    const supabase = await createClient();

    const { data: realOrder } = await supabase
      .from("orders")
      .select(
        "id, code, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_note, delivery_code, vendor_id",
      )
      .eq("id", id)
      .maybeSingle();

    if (!realOrder) notFound();

    const [{ data: realVendor }, { data: realItems }] = await Promise.all([
      supabase
        .from("vendors")
        .select("name")
        .eq("id", realOrder.vendor_id)
        .maybeSingle(),
      supabase
        .from("order_items")
        .select("id, name_snapshot, qty, line_total_kobo")
        .eq("order_id", realOrder.id),
    ]);

    order = realOrder;
    vendor = realVendor;
    items = realItems ?? [];
  }

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
              {items.map((item) => (
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
        <OrderDetailDesktop order={order} vendor={vendor} items={items} />
      </div>
      <div className="md:hidden">
        <OrderDetailMobile order={order} vendor={vendor} items={items} />
      </div>
    </>
  );
}
