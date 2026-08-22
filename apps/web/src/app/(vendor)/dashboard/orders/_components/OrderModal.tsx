// app/(vendor)/orders/_components/OrderModal.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import {
  X,
  Clock,
  User,
  Phone,
  Info,
  CheckCircle,
  Truck,
  Timer,
  XCircle,
  Shield,
  Store,
  ChevronRight,
} from "lucide-react";
import Image from "next/image";
import { formatNaira, koboOf } from "@kiakia/domain";
import type { Order } from "./types";

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
  const [code, setCode] = useState(["", "", "", ""]);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setCode(["", "", "", ""]);
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) return;
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    if (value && index < 3) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

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
        return "text-[#934B00]";
      case "preparing":
        return "text-[#934B00]";
      case "ready_for_pickup":
        return "text-[#176A22]";
      default:
        return "text-[#934B00]";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "placed":
        return "Incoming";
      case "preparing":
        return "Preparing";
      case "ready_for_pickup":
        return "Ready";
      default:
        return status;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm">
      {/* Modal Container - Slides from bottom on mobile */}
      <div className="fixed inset-x-0 bottom-0 top-0 md:right-0 md:top-0 md:w-[450px] md:h-screen bg-[#FCF9F8] shadow-2xl overflow-y-auto flex flex-col animate-slide-up">
        {/* Modal Header */}
        <div className="sticky top-0 z-10 bg-white px-4 py-6 flex items-center justify-between border-b border-[#E4BEB8]">
          <div>
            <h2 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
              {order.code}
            </h2>
            <p className="font-inter text-sm font-semibold text-[#5B403C]">
              Placed at {new Date(order.created_at).toLocaleTimeString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-10 w-10 rounded-full flex items-center justify-center hover:bg-[#F0EDED] transition-colors"
          >
            <X className="size-5 text-[#1C1B1B]" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-32">
          {/* Status & Timer */}
          <div className="flex items-center justify-between p-4 bg-[#F0EDED] rounded-2xl">
            <div>
              <p className="font-inter text-xs font-medium uppercase tracking-[0.6px] text-[#5B403C]">
                Status
              </p>
              <p
                className={`font-sora text-2xl font-semibold ${getStatusColor(order.status)}`}
              >
                {getStatusLabel(order.status)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-inter text-xs font-medium uppercase tracking-[0.6px] text-[#5B403C]">
                Est. Prep Time
              </p>
              <div className="flex items-center justify-end gap-2">
                <Clock className="size-5 text-[#934B00]" />
                <span className="font-inter text-2xl font-bold text-[#934B00]">
                  {order.eta || "25:00"}
                </span>
              </div>
            </div>
          </div>

          {/* Customer Info */}
          <section>
            <h4 className="font-inter text-sm font-semibold text-[#5B403C] mb-4">
              CUSTOMER
            </h4>
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-[#FFDCC5] flex items-center justify-center">
                <span className="font-inter text-lg font-bold text-[#934B00]">
                  {getInitials(order.customer_name || "Customer")}
                </span>
              </div>
              <div>
                <p className="font-inter font-bold text-[#1C1B1B]">
                  {order.customer_name || "Customer"}
                </p>
                <p className="font-inter text-sm font-semibold text-[#5B403C]">
                  {order.customer_phone || "+234 800 000 0000"}
                </p>
              </div>
            </div>
          </section>

          {/* Order Items */}
          <section>
            <h4 className="font-inter text-sm font-semibold text-[#5B403C] mb-4">
              ORDER ITEMS
            </h4>
            <div className="space-y-4">
              {order.items?.map((item) => (
                <div key={item.id} className="flex justify-between items-start">
                  <div className="flex gap-4">
                    <span className="font-inter font-bold text-[#B61913]">
                      {item.quantity}x
                    </span>
                    <div>
                      <p className="font-inter font-bold text-[#1C1B1B]">
                        {item.name}
                      </p>
                      {item.options && (
                        <p className="font-inter text-sm text-[#5B403C]">
                          {item.options}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="font-inter text-[#1C1B1B]">
                    {formatNaira(koboOf(item.price_kobo))}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-6 pt-6 border-t border-[#E4BEB8] space-y-3">
              <div className="flex justify-between">
                <span className="font-inter text-sm font-semibold text-[#5B403C]">
                  Subtotal
                </span>
                <span className="font-inter font-medium text-[#1C1B1B]">
                  {formatNaira(koboOf(order.total_kobo))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-inter text-sm font-semibold text-[#5B403C]">
                  Delivery Fee
                </span>
                <span className="font-inter font-medium text-[#1C1B1B]">
                  {formatNaira(koboOf(120000))}
                </span>
              </div>
              <div className="flex justify-between pt-3 border-t border-[#E4BEB8]">
                <span className="font-inter text-lg font-bold text-[#1C1B1B]">
                  Total
                </span>
                <span className="font-sora text-2xl font-bold text-[#B61913]">
                  {formatNaira(koboOf(order.total_kobo + 120000))}
                </span>
              </div>
            </div>
          </section>

          {/* Customer Note */}
          {order.customer_note && (
            <section className="bg-[rgba(255,220,197,0.3)] border border-[#FFDCC5] p-4 rounded-xl flex gap-4">
              <Info className="size-5 text-[#FE8E27] shrink-0 mt-0.5" />
              <div>
                <h4 className="font-inter text-sm font-semibold text-[#653200]">
                  Customer Note
                </h4>
                <p className="font-inter italic font-medium text-[#653200]">
                  {order.customer_note}
                </p>
              </div>
            </section>
          )}

          {/* Courier Assignment */}
          <section className="border-2 border-[#E4BEB8] rounded-2xl p-4 bg-[#FCF9F8]">
            <p className="font-inter text-xs font-medium text-[#5B403C] mb-3">
              COURIER ASSIGNED
            </p>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[#E5E2E1] flex items-center justify-center">
                <User className="size-4 text-[#1C1B1B]" />
              </div>
              <div className="flex-1">
                <p className="font-inter font-bold text-sm text-[#1C1B1B]">
                  Gokada Express
                </p>
                <p className="font-inter text-[10px] font-bold uppercase text-[#176A22]">
                  5 MINS AWAY
                </p>
              </div>
              <button className="p-2 text-[#B61913] hover:bg-[#B61913]/5 rounded-full">
                <Phone className="size-4" />
              </button>
            </div>
          </section>

          {/* Escrow Verification Code */}
          <section className="border-2 border-[#E4BEB8] rounded-2xl p-4 md:p-6 bg-[#FCF9F8] space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="size-5 text-[#B61913]" />
              <h4 className="font-inter text-sm font-semibold uppercase tracking-[1.4px] text-[#5B403C]">
                Escrow Release Code
              </h4>
            </div>
            <div className="flex justify-center gap-3 md:gap-4">
              {code.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputs.current[index] = el;
                  }}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className="w-14 h-14 md:w-16 md:h-16 rounded-xl border-2 border-[#906F6B] bg-white text-center font-sora text-3xl md:text-4xl font-extrabold text-[#1C1B1B] focus:border-[#B61913] focus:outline-none transition-all"
                  placeholder="-"
                />
              ))}
            </div>
            <p className="font-inter text-xs font-medium text-center text-[#5B403C]">
              Enter the 4-digit code provided by the driver to release funds.
            </p>
          </section>
        </div>

        {/* Modal Actions Footer */}
        <div className="sticky bottom-0 bg-white border-t border-[#E4BEB8] p-4 space-y-3">
          <button
            onClick={() => onStatusChange(order.id, "accepted")}
            className="w-full bg-[#B61913] text-white py-4 rounded-xl font-inter font-bold text-base flex items-center justify-center gap-2 shadow-[0_10px_15px_-3px_rgba(182,25,19,0.2)]"
          >
            <CheckCircle className="size-5" />
            Accept Order
          </button>
          <button
            onClick={() => onStatusChange(order.id, "in_transit")}
            className="w-full bg-[#176A22] text-white py-4 rounded-xl font-inter font-bold text-base flex items-center justify-center gap-2"
          >
            <Truck className="size-5" />
            Out for Delivery
          </button>
          <div className="flex gap-3">
            <button className="flex-1 border-2 border-[#B61913] text-[#B61913] py-3 rounded-xl font-inter font-bold text-base flex items-center justify-center gap-2">
              <Timer className="size-4" />
              Update Prep Time
            </button>
            <button className="flex-1 bg-[rgba(255,218,214,0.2)] text-[#BA1A1A] py-3 rounded-xl font-inter font-bold text-base flex items-center justify-center gap-2">
              <XCircle className="size-4" />
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
