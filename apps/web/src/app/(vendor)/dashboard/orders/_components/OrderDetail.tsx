// app/(vendor)/orders/_components/OrderDetail.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { CheckCircle, Clock, Info, MapPin, Truck, Utensils, X } from "lucide-react";
import Image from "next/image";
import { StatusBadge } from "./StatusBadge";
import type { Order } from "./types";

/** Every status once a rider is in the loop — the vendor has nothing left to
 * action; the rider verifies the delivery code with the customer at drop-off
 * (see fulfillment flow), not the vendor. */
const RIDER_HANDLING_STATUSES = new Set([
  "ready_for_pickup",
  "rider_assigned",
  "picked_up",
  "in_transit",
  "arrived",
]);

interface OrderDetailProps {
  order: Order;
  onStatusChange: (orderId: string, status: string) => void;
}

/**
 * The vendor's next available action(s) for this order's status, as one
 * full-width action bar rather than a cramped sidebar column — that
 * narrow column previously squeezed "Manage Order" into an awkward two-line
 * wrap and made its button look pasted-in, disconnected from the rest of
 * the page.
 */
function ManageOrderActions({ order, onStatusChange }: OrderDetailProps) {
  if (order.status === "placed") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => onStatusChange(order.id, "accepted")}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#B61913] py-4 text-base font-bold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-[#9e1611] active:scale-[0.99]"
        >
          <CheckCircle className="size-5" />
          Accept Order
        </button>
        <button
          onClick={() => onStatusChange(order.id, "rejected_by_vendor")}
          className="flex items-center justify-center gap-2 rounded-xl border-2 border-[#E4BEB8] py-4 text-base font-bold text-[#BA1A1A] transition-colors hover:border-[#BA1A1A]/30 hover:bg-[rgba(186,26,26,0.05)]"
        >
          <X className="size-5" />
          Reject
        </button>
      </div>
    );
  }

  if (order.status === "accepted") {
    return (
      <button
        onClick={() => onStatusChange(order.id, "preparing")}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#176A22] py-4 text-base font-bold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-[#125c1c] active:scale-[0.99]"
      >
        <Truck className="size-5" />
        Start Preparing
      </button>
    );
  }

  if (order.status === "preparing") {
    return (
      <button
        onClick={() => onStatusChange(order.id, "ready_for_pickup")}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#176A22] py-4 text-base font-bold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-[#125c1c] active:scale-[0.99]"
      >
        <CheckCircle className="size-5" />
        Mark Ready for Pickup
      </button>
    );
  }

  if (RIDER_HANDLING_STATUSES.has(order.status)) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-[#F6F3F2] p-4">
        <Truck className="size-5 shrink-0 text-[#5B403C]" />
        <div>
          <p className="text-sm font-medium text-[#1C1B1B]">
            {order.status === "ready_for_pickup"
              ? "Waiting for a rider to be assigned…"
              : "On its way to the customer"}
          </p>
          <p className="text-xs text-[#5B403C]">
            The rider verifies the delivery code with the customer at drop-off — nothing left for you to do here.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

export function OrderDetail({ order, onStatusChange }: OrderDetailProps) {
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#FFDCC5] text-2xl font-bold text-[#934B00]">
              {getInitials(order.customer_name || "Customer")}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-sora text-2xl font-bold text-[#1C1B1B]">
                  {order.customer_name || "Customer"}
                </h2>
                <StatusBadge status={order.status} />
              </div>
              <p className="mt-1 flex items-center gap-1 text-sm text-[#5B403C]">
                <MapPin className="size-4 shrink-0" />
                {order.delivery_address || "Address unavailable"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-[#F6F3F2] px-4 py-2 lg:flex-col lg:items-end lg:gap-0.5 lg:bg-transparent lg:px-0 lg:py-0">
            <Clock className="size-4 text-[#934B00] lg:hidden" />
            <span className="font-sora text-lg font-bold text-[#934B00]">
              {new Date(order.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="text-sm font-medium text-[#5B403C]">Order placed</span>
          </div>
        </div>

        {/* Manage Order — a full-width action bar, not a squeezed sidebar
            column, so the primary action is never the visually smallest
            thing on the page. */}
        <div className="rounded-2xl border-2 border-[#B61913]/15 bg-white p-6 shadow-sm">
          <h3 className="font-inter text-xs font-bold uppercase tracking-wider text-[#5B403C]">
            Manage Order
          </h3>
          <div className="mt-4">
            <ManageOrderActions order={order} onStatusChange={onStatusChange} />
          </div>
        </div>

        {/* Items */}
        <div className="overflow-hidden rounded-2xl border border-[#E4BEB8] bg-white">
          <div className="flex justify-between border-b border-[#E4BEB8] bg-[#F6F3F2] px-6 py-4">
            <h3 className="font-inter text-sm font-bold uppercase tracking-wider text-[#1C1B1B]">
              Order Items
            </h3>
            <span className="text-sm font-bold text-[#1C1B1B]">
              {order.items?.length || 0} Items Total
            </span>
          </div>
          <div>
            {order.items?.map((item, index) => (
              <div
                key={item.id}
                className={`flex items-center gap-4 p-4 ${
                  index < (order.items?.length || 0) - 1 ? "border-b border-[#E4BEB8]" : ""
                } transition-colors hover:bg-[#F6F3F2]`}
              >
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#F0EDED]">
                  {item.image_url ? (
                    <Image src={item.image_url} alt={item.name} fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1]">
                      <Utensils className="size-8 text-[#5B403C]/40" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between">
                    <h4 className="font-inter font-bold text-[#1C1B1B]">{item.name}</h4>
                    <span className="font-bold text-[#B61913]">{formatNaira(koboOf(item.price_kobo))}</span>
                  </div>
                  <p className="text-sm text-[#5B403C]">Quantity: {item.quantity}</p>
                  {item.options && <p className="text-xs italic text-[#5B403C]">{item.options}</p>}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2 bg-[#F6F3F2] p-6">
            {order.subtotal_kobo !== undefined && (
              <div className="flex justify-between text-sm">
                <span className="text-[#5B403C]">Subtotal</span>
                <span className="font-medium text-[#1C1B1B]">{formatNaira(koboOf(order.subtotal_kobo))}</span>
              </div>
            )}
            {order.delivery_fee_kobo !== undefined && (
              <div className="flex justify-between text-sm">
                <span className="text-[#5B403C]">Delivery Fee</span>
                <span className="font-medium text-[#1C1B1B]">{formatNaira(koboOf(order.delivery_fee_kobo))}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-[#E4BEB8] pt-3">
              <span className="text-lg font-bold text-[#1C1B1B]">Total</span>
              <span className="font-sora text-2xl font-bold text-[#B61913]">
                {formatNaira(koboOf(order.total_kobo))}
              </span>
            </div>
          </div>
        </div>

        {/* Customer Note */}
        {order.customer_note && (
          <div className="flex gap-4 rounded-2xl border border-[#FFDCC5] bg-[rgba(255,220,197,0.3)] p-6">
            <Info className="size-5 shrink-0 text-[#934B00]" />
            <div>
              <h4 className="mb-1 font-inter text-sm font-bold text-[#1C1B1B]">Customer Note</h4>
              <p className="text-[#5B403C]">{order.customer_note}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
