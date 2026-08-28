// app/(vendor)/orders/page.tsx
import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
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

  const { data: realOrders } = await supabase
    .from("orders")
    .select(
      "id, code, status, subtotal_kobo, delivery_fee_kobo, total_kobo, created_at, customer_id, delivery_address, delivery_note",
    )
    .eq("vendor_id", vendor.id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: true });
  const rawOrders = realOrders ?? [];

  if (rawOrders.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
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
  const customerIds = [...new Set(rawOrders.map((order) => order.customer_id))];

  const [{ data: itemRows }, { data: profileRows }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, order_id, menu_item_id, name_snapshot, qty, options_snapshot, line_total_kobo")
      .in("order_id", orderIds),
    supabase.from("profiles").select("id, full_name, phone").in("id", customerIds),
  ]);

  const menuItemIds = [...new Set((itemRows ?? []).map((item) => item.menu_item_id))];
  const { data: menuItemRows } = menuItemIds.length
    ? await supabase.from("menu_items").select("id, image_url").in("id", menuItemIds)
    : { data: [] as { id: string; image_url: string | null }[] };

  const imageByMenuItemId = new Map((menuItemRows ?? []).map((m) => [m.id, m.image_url]));
  const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));

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
    const profile = profileById.get(order.customer_id);
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      subtotal_kobo: order.subtotal_kobo,
      delivery_fee_kobo: order.delivery_fee_kobo,
      total_kobo: order.total_kobo,
      created_at: order.created_at,
      customer_name: profile?.full_name ?? undefined,
      customer_phone: profile?.phone ?? undefined,
      items: itemsByOrderId.get(order.id) ?? [],
      delivery_address: formatAddress(order.delivery_address),
      customer_note: order.delivery_note,
    };
  });

  return <OrdersWrapper orders={orders} />;
}
