import { getVendorForCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, koboOf } from "@kiakia/domain";
import { ChevronLeft, Info, MapPin, Utensils } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VendorOrderActions } from "../../../_components/VendorOrderActions";
import { StatusBadge } from "../_components/StatusBadge";

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
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 lg:px-6">
      <Link
        href="/dashboard/orders"
        className="inline-flex items-center gap-1 text-sm font-medium text-[#5B403C] transition-colors hover:text-[#B61913]"
      >
        <ChevronLeft className="size-4" />
        Back to orders
      </Link>

      <div className="mt-3 flex items-center justify-between gap-4">
        <h1 className="font-sora text-2xl font-bold text-[#1C1B1B] lg:text-3xl">{order.code}</h1>
        <StatusBadge status={order.status} />
      </div>

      <div className="mt-6 rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm">
        <h2 className="font-inter text-sm font-bold uppercase tracking-wider text-[#1C1B1B]">
          Manage Order
        </h2>
        <div className="mt-4">
          <VendorOrderActions orderId={order.id} status={order.status} />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-[#E4BEB8] bg-white shadow-sm">
        <div className="border-b border-[#E4BEB8] bg-[#F6F3F2] px-6 py-4">
          <h2 className="font-inter text-sm font-bold uppercase tracking-wider text-[#1C1B1B]">
            Items
          </h2>
        </div>
        {(items ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Utensils className="size-8 text-[#5B403C]/30" />
            <p className="text-sm text-[#5B403C]">No items on this order.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#E4BEB8]">
            {(items ?? []).map((item) => (
              <li key={item.id} className="flex justify-between px-6 py-4">
                <span className="font-inter font-medium text-[#1C1B1B]">
                  {item.qty}&times; {item.name_snapshot}
                </span>
                <span className="font-inter font-bold text-[#1C1B1B]">
                  {formatNaira(koboOf(item.line_total_kobo))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 bg-[#F6F3F2] p-6">
          <div className="flex justify-between text-sm">
            <span className="text-[#5B403C]">Subtotal</span>
            <span className="font-medium text-[#1C1B1B]">
              {formatNaira(koboOf(order.subtotal_kobo))}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#5B403C]">Delivery Fee</span>
            <span className="font-medium text-[#1C1B1B]">
              {formatNaira(koboOf(order.delivery_fee_kobo))}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#5B403C]">Service Fee</span>
            <span className="font-medium text-[#1C1B1B]">
              {formatNaira(koboOf(order.service_fee_kobo))}
            </span>
          </div>
          <div className="flex justify-between border-t border-[#E4BEB8] pt-3">
            <span className="font-bold text-[#1C1B1B]">Total</span>
            <span className="font-sora text-xl font-bold text-[#B61913]">
              {formatNaira(koboOf(order.total_kobo))}
            </span>
          </div>
        </div>
      </div>

      {address?.line1 && (
        <div className="mt-6 rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 font-inter text-sm font-bold uppercase tracking-wider text-[#1C1B1B]">
            <MapPin className="size-4 text-[#5B403C]" />
            Delivery Address
          </h2>
          <p className="mt-3 text-sm text-[#1C1B1B]">
            {address.line1}
            {address.landmark ? `, near ${address.landmark}` : ""}
          </p>
          <p className="text-sm text-[#5B403C]">
            {address.city}, {address.state}
          </p>
          {order.delivery_note && (
            <div className="mt-4 flex gap-3 rounded-xl border border-[#FFDCC5] bg-[rgba(255,220,197,0.3)] p-4">
              <Info className="size-4 shrink-0 text-[#934B00]" />
              <p className="text-sm italic text-[#5B403C]">&ldquo;{order.delivery_note}&rdquo;</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
