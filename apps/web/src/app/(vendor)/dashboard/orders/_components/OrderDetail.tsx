// app/(vendor)/orders/_components/OrderDetail.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import {
  Clock,
  MapPin,
  User,
  Phone,
  Info,
  CheckCircle,
  Truck,
  Timer,
  X,
} from "lucide-react";
import Image from "next/image";
import { StatusBadge } from "./StatusBadge";
import { EscrowCodeInput } from "./EscrowCodeInput";
import type { Order } from "./types";

interface OrderDetailProps {
  order: Order;
  onStatusChange: (orderId: string, status: string) => void;
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
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Detail Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E4BEB8] shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-[#FFDCC5] flex items-center justify-center text-2xl font-bold text-[#934B00]">
              {getInitials(order.customer_name || "Customer")}
            </div>
            <div>
              <h2 className="font-sora text-2xl font-bold text-[#1C1B1B]">
                {order.customer_name || "Customer"}
              </h2>
              <p className="text-sm text-[#5B403C] flex items-center gap-1">
                <MapPin className="size-4" />
                {order.delivery_address || "Lagos, Nigeria"}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="size-5 text-[#934B00] animate-pulse" />
              <span className="font-sora text-2xl font-bold text-[#934B00]">
                {order.eta || "25:00"}
              </span>
            </div>
            <span className="text-sm font-medium text-[#5B403C]">
              Estimated Prep Time
            </span>
          </div>
        </div>

        {/* Order Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Items List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-[#E4BEB8] overflow-hidden">
              <div className="px-6 py-4 bg-[#F6F3F2] border-b border-[#E4BEB8] flex justify-between">
                <h3 className="font-inter text-sm font-bold uppercase tracking-wider text-[#1C1B1B]">
                  Order Items
                </h3>
                <span className="text-sm font-bold">
                  {order.items?.length || 0} Items Total
                </span>
              </div>
              <div className="p-0">
                {order.items?.map((item, index) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-4 p-4 ${
                      index < (order.items?.length || 0) - 1
                        ? "border-b border-[#E4BEB8]"
                        : ""
                    } hover:bg-[#F6F3F2] transition-colors`}
                  >
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#F0EDED]">
                      {item.image_url ? (
                        <Image
                          src={item.image_url}
                          alt={item.name}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[#E5E2E1]">
                          <span className="text-2xl">🍽️</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <h4 className="font-inter font-bold text-[#1C1B1B]">
                          {item.name}
                        </h4>
                        <span className="font-bold text-[#B61913]">
                          {formatNaira(koboOf(item.price_kobo))}
                        </span>
                      </div>
                      <p className="text-sm text-[#5B403C]">
                        Quantity: {item.quantity}
                      </p>
                      {item.options && (
                        <p className="text-xs text-[#5B403C] italic">
                          {item.options}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-6 bg-[#F6F3F2]">
                <div className="flex justify-between mb-2">
                  <span className="text-[#5B403C]">Subtotal</span>
                  <span className="font-medium">
                    {formatNaira(koboOf(order.total_kobo))}
                  </span>
                </div>
                <div className="flex justify-between mb-4">
                  <span className="text-[#5B403C]">Delivery Fee</span>
                  <span className="font-medium">₦1,200</span>
                </div>
                <div className="flex justify-between pt-4 border-t border-[#E4BEB8]">
                  <span className="font-bold text-lg">Total</span>
                  <span className="font-sora text-2xl font-bold text-[#B61913]">
                    {formatNaira(koboOf(order.total_kobo + 120000))}
                  </span>
                </div>
              </div>
            </div>

            {/* Customer Note */}
            {order.customer_note && (
              <div className="bg-[rgba(255,220,197,0.3)] border border-[#FFDCC5] p-6 rounded-2xl flex gap-4">
                <Info className="size-5 text-[#934B00] shrink-0" />
                <div>
                  <h4 className="font-inter text-sm font-bold text-[#1C1B1B] mb-1">
                    Customer Note
                  </h4>
                  <p className="text-[#5B403C]">{order.customer_note}</p>
                </div>
              </div>
            )}
          </div>

          {/* Actions Panel */}
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-2xl border border-[#E4BEB8] shadow-sm sticky top-24">
              <h3 className="font-inter text-sm font-bold uppercase tracking-wider mb-6">
                Manage Order
              </h3>
              <div className="space-y-3">
                <button
                  onClick={() => onStatusChange(order.id, "accepted")}
                  className="w-full bg-[#B61913] text-white py-4 rounded-xl font-bold text-base shadow-lg shadow-[#B61913]/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle className="size-5" />
                  Accept Order
                </button>
                <button
                  onClick={() => onStatusChange(order.id, "in_transit")}
                  className="w-full bg-[#176A22] text-white py-4 rounded-xl font-bold text-base hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Truck className="size-5" />
                  Out for Delivery
                </button>
                <div className="py-2" />
                <button className="w-full border-2 border-[#B61913] text-[#B61913] py-4 rounded-xl font-bold text-base hover:bg-[#B61913]/5 transition-all flex items-center justify-center gap-2">
                  <Timer className="size-5" />
                  Update Prep Time
                </button>
                <button className="w-full text-[#BA1A1A] font-bold py-4 rounded-xl hover:bg-[rgba(186,26,26,0.1)] transition-all flex items-center justify-center gap-2">
                  <X className="size-5" />
                  Reject Order
                </button>
              </div>

              {/* Escrow Code */}
              <div className="mt-8 pt-6 border-t border-[#E4BEB8]">
                <EscrowCodeInput />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
