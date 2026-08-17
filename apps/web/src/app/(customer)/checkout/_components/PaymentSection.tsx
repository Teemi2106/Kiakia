// app/(customer)/checkout/_components/PaymentSection.tsx
"use client";

import {
  CreditCard,
  DollarSign,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
} from "lucide-react";
import { useState } from "react";
import type { PaymentMethod } from "./types";

interface PaymentSectionProps {
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  variant?: "desktop" | "mobile";
}

export function PaymentSection({
  paymentMethod,
  onPaymentMethodChange,
  variant = "desktop",
}: PaymentSectionProps) {
  const isMobile = variant === "mobile";
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const getPaymentLabel = (method: PaymentMethod) => {
    return method === "card" ? "Credit / Debit Card" : "Cash on Delivery";
  };

  const getPaymentSubtext = (method: PaymentMethod) => {
    return method === "card"
      ? "Visa, Mastercard, Verve"
      : "Pay when you receive your order";
  };

  const getPaymentIcon = (method: PaymentMethod) => {
    return method === "card" ? CreditCard : DollarSign;
  };

  // Desktop Version
  if (!isMobile) {
    return (
      <div className="rounded-2xl border border-[#E4BEB8] bg-white p-4 shadow-sm">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Payment Method
          </h2>
          <button className="rounded-full p-2 hover:bg-black/5">
            <Plus className="size-4 text-[#B61913]" />
          </button>
        </div>

        {/* Selected Payment Option */}
        <div className="mb-3 rounded-xl border-2 border-[rgba(182,25,19,0.2)] bg-[#F6F3F2] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-12 items-center justify-center rounded bg-[#E5E2E1]">
                {paymentMethod === "card" ? (
                  <CreditCard className="size-5 text-[#5B403C]" />
                ) : (
                  <DollarSign className="size-5 text-[#5B403C]" />
                )}
              </div>
              <div>
                <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
                  {getPaymentLabel(paymentMethod)}
                </p>
                <p className="font-inter text-xs text-[#5B403C]">
                  {getPaymentSubtext(paymentMethod)}
                </p>
              </div>
            </div>
            <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#B61913]">
              <Check className="size-3 text-[#B61913]" />
            </div>
          </div>
        </div>

        {/* Other Payment Option */}
        <div
          className="cursor-pointer rounded-xl border border-[#E4BEB8] bg-[#F6F3F2] p-4 transition-colors hover:border-[#B61913]"
          onClick={() =>
            onPaymentMethodChange(paymentMethod === "card" ? "cash" : "card")
          }
        >
          <div className="flex items-center gap-4">
            <div className="flex h-8 w-12 items-center justify-center rounded bg-[#E5E2E1]">
              {paymentMethod === "card" ? (
                <DollarSign className="size-5 text-[#5B403C]" />
              ) : (
                <CreditCard className="size-5 text-[#5B403C]" />
              )}
            </div>
            <div>
              <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
                {paymentMethod === "card"
                  ? "Cash on Delivery"
                  : "Credit / Debit Card"}
              </p>
              <p className="font-inter text-xs text-[#5B403C]">
                {paymentMethod === "card"
                  ? "Pay when you receive your order"
                  : "Visa, Mastercard, Verve"}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Mobile Version - Just the payment options without the outer header
  return (
    <div className="space-y-3">
      {/* Selected Payment Option */}
      <div className="rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E5E2E1]">
            {paymentMethod === "card" ? (
              <CreditCard className="size-5 text-[#5B403C]" />
            ) : (
              <DollarSign className="size-5 text-[#5B403C]" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
              {paymentMethod === "card"
                ? "Visa ending in 4242"
                : "Cash on Delivery"}
            </p>
            <p className="font-inter text-xs text-[#5B403C]">
              {paymentMethod === "card"
                ? "Credit / Debit Card"
                : "Pay when you receive"}
            </p>
          </div>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5"
          >
            {isDropdownOpen ? (
              <ChevronUp className="size-4 text-[#5B403C]" />
            ) : (
              <ChevronDown className="size-4 text-[#5B403C]" />
            )}
          </button>
        </div>
      </div>

      {/* Dropdown - Shows the other option when open */}
      {isDropdownOpen && (
        <div
          className="cursor-pointer rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] p-4 transition-colors hover:border-[#B61913]"
          onClick={() => {
            onPaymentMethodChange(paymentMethod === "card" ? "cash" : "card");
            setIsDropdownOpen(false);
          }}
        >
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E5E2E1]">
              {paymentMethod === "card" ? (
                <DollarSign className="size-5 text-[#5B403C]" />
              ) : (
                <CreditCard className="size-5 text-[#5B403C]" />
              )}
            </div>
            <div>
              <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
                {paymentMethod === "card"
                  ? "Cash on Delivery"
                  : "Visa ending in 4242"}
              </p>
              <p className="font-inter text-xs text-[#5B403C]">
                {paymentMethod === "card"
                  ? "Pay when you receive your order"
                  : "Credit / Debit Card"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
