// app/(vendor)/orders/_components/OrderModal.tsx
"use client";

import { useEffect } from "react";
import { X, Clock, Info, CheckCircle, Truck, XCircle } from "lucide-react";
import { formatNaira, koboOf } from "@kiakia/domain";
import { DeliverySection } from "../../../_components/DeliverySection";
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

interface OrderModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusChange: (orderId: string, status: string) => void;
}

export function OrderModal({
  order,
  isOpen,
  onClose,
  onStatusChange,
}: OrderModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || !order) return null;

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "placed":
      case "accepted":
      case "preparing":
        return "text-kk-orange-ink";
      case "rejected_by_vendor":
        return "text-kk-danger-ink";
      default:
        return "text-kk-green-ink";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "placed":
        return "Incoming";
      case "accepted":
        return "Accepted";
      case "preparing":
        return "Preparing";
      case "rejected_by_vendor":
        return "Rejected";
      case "ready_for_pickup":
        return "Ready for pickup";
      case "rider_assigned":
        return "Rider assigned";
      case "picked_up":
        return "Picked up";
      case "in_transit":
        return "On the way";
      case "arrived":
        return "Arrived";
      case "delivered":
        return "Delivered";
      default:
        return status;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm">
      {/* Modal Container - Slides from bottom on mobile */}
      <div className="fixed inset-x-0 bottom-0 top-0 md:right-0 md:top-0 md:w-[450px] md:h-screen bg-kk-cream shadow-2xl overflow-y-auto flex flex-col animate-slide-up">
        {/* Modal Header */}
        <div className="sticky top-0 z-10 bg-kk-card px-4 py-6 flex items-center justify-between border-b border-kk-line">
          <div>
            <h2 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-kk-ink">
              {order.code}
            </h2>
            <p className="font-inter text-sm font-semibold text-kk-cocoa">
              Placed at {new Date(order.created_at).toLocaleTimeString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-10 w-10 rounded-full flex items-center justify-center hover:bg-kk-fill transition-colors"
          >
            <X className="size-5 text-kk-ink" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-32">
          {/* Status */}
          <div className="flex items-center justify-between p-4 bg-kk-fill rounded-2xl">
            <div>
              <p className="font-inter text-xs font-medium uppercase tracking-[0.6px] text-kk-cocoa">
                Status
              </p>
              <p
                className={`font-sora text-2xl font-semibold ${getStatusColor(order.status)}`}
              >
                {getStatusLabel(order.status)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-inter text-xs font-medium uppercase tracking-[0.6px] text-kk-cocoa">
                Placed At
              </p>
              <div className="flex items-center justify-end gap-2">
                <Clock className="size-5 text-kk-orange-ink" />
                <span className="font-inter text-lg font-bold text-kk-orange-ink">
                  {new Date(order.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* Customer Info */}
          <section>
            <h4 className="font-inter text-sm font-semibold text-kk-cocoa mb-4">
              CUSTOMER
            </h4>
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-notice-surface flex items-center justify-center">
                <span className="font-inter text-lg font-bold text-kk-orange-ink">
                  {getInitials(order.customer_name || "Customer")}
                </span>
              </div>
              <div>
                <p className="font-inter font-bold text-kk-ink">
                  {order.customer_name || "Customer"}
                </p>
                {order.customer_phone && (
                  <p className="font-inter text-sm font-semibold text-kk-cocoa">
                    {order.customer_phone}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Order Items */}
          <section>
            <h4 className="font-inter text-sm font-semibold text-kk-cocoa mb-4">
              ORDER ITEMS
            </h4>
            <div className="space-y-4">
              {order.items?.map((item) => (
                <div key={item.id} className="flex justify-between items-start">
                  <div className="flex gap-4">
                    <span className="font-inter font-bold text-kk-red-ink">
                      {item.quantity}x
                    </span>
                    <div>
                      <p className="font-inter font-bold text-kk-ink">
                        {item.name}
                      </p>
                      {item.options && (
                        <p className="font-inter text-sm text-kk-cocoa">
                          {item.options}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="font-inter text-kk-ink">
                    {formatNaira(koboOf(item.price_kobo))}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-6 pt-6 border-t border-kk-line space-y-3">
              {order.subtotal_kobo !== undefined && (
                <div className="flex justify-between">
                  <span className="font-inter text-sm font-semibold text-kk-cocoa">
                    Subtotal
                  </span>
                  <span className="font-inter font-medium text-kk-ink">
                    {formatNaira(koboOf(order.subtotal_kobo))}
                  </span>
                </div>
              )}
              {order.delivery_fee_kobo !== undefined && (
                <div className="flex justify-between">
                  <span className="font-inter text-sm font-semibold text-kk-cocoa">
                    Delivery Fee
                  </span>
                  <span className="font-inter font-medium text-kk-ink">
                    {formatNaira(koboOf(order.delivery_fee_kobo))}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-3 border-t border-kk-line">
                <span className="font-inter text-lg font-bold text-kk-ink">
                  Total
                </span>
                <span className="font-sora text-2xl font-bold text-kk-red-ink">
                  {formatNaira(koboOf(order.total_kobo))}
                </span>
              </div>
            </div>
          </section>

          {/* Customer Note */}
          {order.customer_note && (
            <section className="bg-[rgba(255,220,197,0.3)] border border-notice-surface p-4 rounded-xl flex gap-4">
              <Info className="size-5 text-kk-orange shrink-0 mt-0.5" />
              <div>
                <h4 className="font-inter text-sm font-semibold text-kk-orange-darkest">
                  Customer Note
                </h4>
                <p className="font-inter italic font-medium text-kk-orange-darkest">
                  {order.customer_note}
                </p>
              </div>
            </section>
          )}

          <DeliverySection
            orderId={order.id}
            status={order.status}
            deliveryBy={order.delivery_by}
            dispatch={order.dispatch}
            deliveryFeeKobo={order.delivery_fee_kobo ?? 0}
          />

          {/* Rider handoff */}
          {order.delivery_by !== "vendor" && RIDER_HANDLING_STATUSES.has(order.status) && (
            <section className="border-2 border-kk-line rounded-2xl p-4 bg-kk-cream text-center">
              <Truck className="mx-auto size-5 text-kk-cocoa" />
              <p className="mt-2 font-inter text-sm font-bold text-kk-ink">
                {order.status === "ready_for_pickup"
                  ? "Waiting for a rider to be assigned…"
                  : "On its way to the customer"}
              </p>
              <p className="mt-1 font-inter text-xs text-kk-cocoa">
                The rider verifies the delivery code with the customer at
                drop-off — nothing left for you to do here.
              </p>
            </section>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className="sticky bottom-0 bg-kk-card border-t border-kk-line p-4 space-y-3">
          {/* Status-conditional, mirroring VendorOrderActions.tsx's state
              machine — ready_for_pickup onward needs a rider (Phase 3). */}
          {order.status === "placed" && (
            <>
              <button
                onClick={() => onStatusChange(order.id, "accepted")}
                className="w-full bg-kk-red text-white py-4 rounded-xl font-inter font-bold text-base flex items-center justify-center gap-2 shadow-[0_10px_15px_-3px_rgba(182,25,19,0.2)]"
              >
                <CheckCircle className="size-5" />
                Accept Order
              </button>
              <button
                onClick={() => onStatusChange(order.id, "rejected_by_vendor")}
                className="w-full bg-[rgba(255,218,214,0.2)] text-kk-danger-ink py-3 rounded-xl font-inter font-bold text-base flex items-center justify-center gap-2"
              >
                <XCircle className="size-4" />
                Reject
              </button>
            </>
          )}
          {order.status === "accepted" && (
            <button
              onClick={() => onStatusChange(order.id, "preparing")}
              className="w-full bg-kk-green text-white py-4 rounded-xl font-inter font-bold text-base flex items-center justify-center gap-2"
            >
              <Truck className="size-5" />
              Start Preparing
            </button>
          )}
          {order.status === "preparing" && (
            <button
              onClick={() => onStatusChange(order.id, "ready_for_pickup")}
              className="w-full bg-kk-green text-white py-4 rounded-xl font-inter font-bold text-base flex items-center justify-center gap-2"
            >
              <CheckCircle className="size-5" />
              Mark Ready for Pickup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
