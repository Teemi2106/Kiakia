// app/(vendor)/orders/_components/OrderDetail.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { CheckCircle, Clock, Info, MapPin, Truck, Utensils, X } from "lucide-react";
import Image from "next/image";
import { DeliverySection } from "../../../_components/DeliverySection";
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
          className="flex items-center justify-center gap-2 rounded-xl bg-kk-red py-4 text-base font-bold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-kk-red-hover active:scale-[0.99]"
        >
          <CheckCircle className="size-5" />
          Accept Order
        </button>
        <button
          onClick={() => onStatusChange(order.id, "rejected_by_vendor")}
          className="flex items-center justify-center gap-2 rounded-xl border-2 border-kk-line py-4 text-base font-bold text-kk-danger-ink transition-colors hover:border-kk-danger/30 hover:bg-[rgba(186,26,26,0.05)]"
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
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-kk-green py-4 text-base font-bold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-[#125c1c] active:scale-[0.99]"
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
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-kk-green py-4 text-base font-bold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-[#125c1c] active:scale-[0.99]"
      >
        <CheckCircle className="size-5" />
        Mark Ready for Pickup
      </button>
    );
  }

  if (order.delivery_by === "vendor") return null;

  if (RIDER_HANDLING_STATUSES.has(order.status)) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-kk-sand p-4">
        <Truck className="size-5 shrink-0 text-kk-cocoa" />
        <div>
          <p className="text-sm font-medium text-kk-ink">
            {order.status === "ready_for_pickup"
              ? "Waiting for a rider to be assigned…"
              : "On its way to the customer"}
          </p>
          <p className="text-xs text-kk-cocoa">
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
        <div className="flex flex-col gap-4 rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-notice-surface text-2xl font-bold text-kk-orange-ink">
              {getInitials(order.customer_name || "Customer")}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-sora text-2xl font-bold text-kk-ink">
                  {order.customer_name || "Customer"}
                </h2>
                <StatusBadge status={order.status} />
              </div>
              <p className="mt-1 flex items-center gap-1 text-sm text-kk-cocoa">
                <MapPin className="size-4 shrink-0" />
                {order.delivery_address || "Address unavailable"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-kk-sand px-4 py-2 lg:flex-col lg:items-end lg:gap-0.5 lg:bg-transparent lg:px-0 lg:py-0">
            <Clock className="size-4 text-kk-orange-ink lg:hidden" />
            <span className="font-sora text-lg font-bold text-kk-orange-ink">
              {new Date(order.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="text-sm font-medium text-kk-cocoa">Order placed</span>
          </div>
        </div>

        <DeliverySection
          orderId={order.id}
          status={order.status}
          deliveryBy={order.delivery_by}
          dispatch={order.dispatch}
          deliveryFeeKobo={order.delivery_fee_kobo ?? 0}
        />

        {/* Manage Order — a full-width action bar, not a squeezed sidebar
            column, so the primary action is never the visually smallest
            thing on the page. */}
        <div className="rounded-2xl border-2 border-kk-red/15 bg-kk-card p-6 shadow-sm">
          <h3 className="font-inter text-xs font-bold uppercase tracking-wider text-kk-cocoa">
            Manage Order
          </h3>
          <div className="mt-4">
            <ManageOrderActions order={order} onStatusChange={onStatusChange} />
          </div>
        </div>

        {/* Items */}
        <div className="overflow-hidden rounded-2xl border border-kk-line bg-kk-card">
          <div className="flex justify-between border-b border-kk-line bg-kk-sand px-6 py-4">
            <h3 className="font-inter text-sm font-bold uppercase tracking-wider text-kk-ink">
              Order Items
            </h3>
            <span className="text-sm font-bold text-kk-ink">
              {order.items?.length || 0} Items Total
            </span>
          </div>
          <div>
            {order.items?.map((item, index) => (
              <div
                key={item.id}
                className={`flex items-center gap-4 p-4 ${
                  index < (order.items?.length || 0) - 1 ? "border-b border-kk-line" : ""
                } transition-colors hover:bg-kk-sand`}
              >
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-kk-fill">
                  {item.image_url ? (
                    <Image src={item.image_url} alt={item.name} fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-kk-hair">
                      <Utensils className="size-8 text-kk-cocoa/40" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between">
                    <h4 className="font-inter font-bold text-kk-ink">{item.name}</h4>
                    <span className="font-bold text-kk-red-ink">{formatNaira(koboOf(item.price_kobo))}</span>
                  </div>
                  <p className="text-sm text-kk-cocoa">Quantity: {item.quantity}</p>
                  {item.options && <p className="text-xs italic text-kk-cocoa">{item.options}</p>}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2 bg-kk-sand p-6">
            {order.subtotal_kobo !== undefined && (
              <div className="flex justify-between text-sm">
                <span className="text-kk-cocoa">Subtotal</span>
                <span className="font-medium text-kk-ink">{formatNaira(koboOf(order.subtotal_kobo))}</span>
              </div>
            )}
            {order.delivery_fee_kobo !== undefined && (
              <div className="flex justify-between text-sm">
                <span className="text-kk-cocoa">Delivery Fee</span>
                <span className="font-medium text-kk-ink">{formatNaira(koboOf(order.delivery_fee_kobo))}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-kk-line pt-3">
              <span className="text-lg font-bold text-kk-ink">Total</span>
              <span className="font-sora text-2xl font-bold text-kk-red-ink">
                {formatNaira(koboOf(order.total_kobo))}
              </span>
            </div>
          </div>
        </div>

        {/* Customer Note */}
        {order.customer_note && (
          <div className="flex gap-4 rounded-2xl border border-notice-surface bg-[rgba(255,220,197,0.3)] p-6">
            <Info className="size-5 shrink-0 text-kk-orange-ink" />
            <div>
              <h4 className="mb-1 font-inter text-sm font-bold text-kk-ink">Customer Note</h4>
              <p className="text-kk-cocoa">{order.customer_note}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
