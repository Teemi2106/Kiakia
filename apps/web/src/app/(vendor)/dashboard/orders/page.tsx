// app/(vendor)/orders/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/lib/realtime/RealtimeRefresh";
import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrdersWrapper } from "./_components/OrdersWrapper";
import type { Order, OrderItem } from "./_components/types";

export const metadata: Metadata = { title: "Orders" };

const ACTIVE_STATUSES = [
  "placed",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "rider_assigned",
  "picked_up",
  "in_transit",
  "arrived",
] as const;

interface DeliveryAddress {
  line1?: string;
  landmark?: string;
  city?: string;
  state?: string;
}

function formatAddress(address: unknown): string | undefined {
  const a = address as DeliveryAddress | null;
  if (!a?.line1) return undefined;
  const parts = [a.line1, a.landmark ? `near ${a.landmark}` : null, a.city, a.state].filter(Boolean);
  return parts.join(", ");
}

function formatOptions(optionsSnapshot: unknown): string | null {
  if (!Array.isArray(optionsSnapshot) || optionsSnapshot.length === 0) return null;
  return optionsSnapshot
    .map((o) => (o && typeof o === "object" && "name" in o ? String((o as { name: unknown }).name) : null))
    .filter(Boolean)
    .join(", ");
}

export default async function VendorOrdersPage() {
  const vendor = await getVendorForCurrentUser();
  if (!vendor) notFound();

  const supabase = await createClient();

  // The photo lookup does not depend on which orders are active (it is this
  // store's own menu images, joined in JS below), so it rides in the first wave
  // instead of waiting behind the items as a third.
  const [{ data: realOrders }, { data: menuImageRows }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, code, status, subtotal_kobo, delivery_fee_kobo, total_kobo, created_at, delivery_address, delivery_note",
      )
      .eq("vendor_id", vendor.id)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: true }),
    supabase.from("menu_items").select("id, image_url").eq("vendor_id", vendor.id).not("image_url", "is", null),
  ]);
  const rawOrders = realOrders ?? [];

  if (rawOrders.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <RealtimeRefresh
          table="orders"
          filter={`vendor_id=eq.${vendor.id}`}
          topic={`vendor-orders-${vendor.id}`}
        />
        <h1 className="font-sora text-2xl font-bold text-[#1C1B1B]">Active Orders</h1>
        <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#E4BEB8] bg-white p-12 text-center">
          <ClipboardList className="size-8 text-[#5B403C]/30" />
          <p className="font-medium text-[#1C1B1B]">No active orders</p>
          <p className="max-w-sm text-sm text-[#5B403C]">
            New orders will show up here as customers place them.
          </p>
        </div>
      </div>
    );
  }

  const orderIds = rawOrders.map((order) => order.id);

  const [{ data: itemRows }, { data: contactRows }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, order_id, menu_item_id, name_snapshot, qty, options_snapshot, line_total_kobo")
      .in("order_id", orderIds),
    // profiles is own-row-only under RLS, so a direct read of a customer's
    // profile returns nothing for vendor staff - names and phones never showed.
    // This SECURITY DEFINER read is scoped to this vendor's in-flight orders
    // (0077_input_and_exposure_hardening.sql).
    supabase.rpc("get_vendor_order_customers", { p_order_ids: orderIds }),
  ]);

  const imageByMenuItemId = new Map((menuImageRows ?? []).map((m) => [m.id, m.image_url]));
  const contactByOrderId = new Map((contactRows ?? []).map((c) => [c.order_id, c]));

  const itemsByOrderId = new Map<string, OrderItem[]>();
  for (const item of itemRows ?? []) {
    const list = itemsByOrderId.get(item.order_id) ?? [];
    list.push({
      id: item.id,
      name: item.name_snapshot,
      quantity: item.qty,
      price_kobo: item.line_total_kobo,
      image_url: imageByMenuItemId.get(item.menu_item_id) ?? null,
      options: formatOptions(item.options_snapshot),
    });
    itemsByOrderId.set(item.order_id, list);
  }

  const orders: Order[] = rawOrders.map((order) => {
    const contact = contactByOrderId.get(order.id);
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      subtotal_kobo: order.subtotal_kobo,
      delivery_fee_kobo: order.delivery_fee_kobo,
      total_kobo: order.total_kobo,
      created_at: order.created_at,
      customer_name: contact?.customer_name ?? undefined,
      customer_phone: contact?.customer_phone ?? undefined,
      items: itemsByOrderId.get(order.id) ?? [],
      delivery_address: formatAddress(order.delivery_address),
      customer_note: order.delivery_note,
    };
  });

  return (
    <>
      <RealtimeRefresh
        table="orders"
        filter={`vendor_id=eq.${vendor.id}`}
        topic={`vendor-orders-${vendor.id}`}
      />
      <OrdersWrapper orders={orders} />
    </>
  );
}
