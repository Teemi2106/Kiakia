// app/(customer)/checkout/_components/PaymentSection.tsx
"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { cn } from "@kiakia/ui";
import { Banknote, Check, CreditCard, Wallet } from "lucide-react";
import type { PaymentMethod } from "./types";

interface PaymentSectionProps {
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  /** The customer's own wallet balance in kobo (get_wallet_balance(),
   * 0045_customer_wallet.sql). Zero for anyone who has never been refunded. */
  walletBalanceKobo: number;
  /** Used only to decide whether the wallet is offerable at all — see the
   * note on `walletCovers` below for why it is not the final word. */
  subtotalKobo: number;
  variant?: "desktop" | "mobile";
}

/**
 * Card and wallet are the two methods placeOrderAction actually supports.
 * Cash on Delivery is listed so customers know it's planned, but disabled
 * and marked "Coming soon" rather than left selectable while silently still
 * charging the card via Monnify.
 *
 * A wallet only exists here because an order was cancelled or rejected —
 * 0045_customer_wallet.sql credits the refund straight to it instead of
 * sending the customer away to wait days on a Monnify card refund. There is
 * no top-up flow, so a zero balance is the normal case and the option is
 * hidden entirely rather than shown as a dead entry.
 */
export function PaymentSection({
  paymentMethod,
  onPaymentMethodChange,
  walletBalanceKobo,
  subtotalKobo,
  variant = "desktop",
}: PaymentSectionProps) {
  const isMobile = variant === "mobile";
  const hasWallet = walletBalanceKobo > 0;

  // Deliberately checked against the SUBTOTAL, not a total: delivery and
  // service fees are priced server-side by place_order() and aren't known
  // here (OrderSummary shows a 0 delivery fee for the same reason). So this
  // can only rule the wallet OUT with certainty, never in —
  // pay_order_from_wallet() re-checks against the real total under a lock and
  // is the actual authority. placeOrderAction surfaces that shortfall as a
  // "pay by card instead" message rather than a dead end.
  const walletCovers = walletBalanceKobo >= subtotalKobo;

  // The mobile layout already wraps this in its own numbered step card with
  // its own "Payment Method" heading (CheckoutMobile.tsx), so rendering a
  // second card and heading here would duplicate both. Desktop has no such
  // wrapper and needs them.
  const options = (
    <div className="space-y-3">
      <PaymentOption
        selected={paymentMethod === "card"}
        onSelect={() => onPaymentMethodChange("card")}
        icon={<CreditCard className="size-5 text-[#5B403C]" />}
        title="Credit / Debit Card"
        subtitle="Visa, Mastercard, Verve — via Monnify"
      />

      {hasWallet && (
        <PaymentOption
          selected={paymentMethod === "wallet"}
          onSelect={() => onPaymentMethodChange("wallet")}
          disabled={!walletCovers}
          icon={<Wallet className="size-5 text-[#176A22]" />}
          title="KiaKia Wallet"
          subtitle={
            walletCovers
              ? `${formatNaira(koboOf(walletBalanceKobo))} available — paid instantly, no card needed`
              : `${formatNaira(koboOf(walletBalanceKobo))} available — not enough for this order`
          }
        />
      )}

      <PaymentOption
        selected={false}
        disabled
        icon={<Banknote className="size-5 text-[#5B403C]" />}
        title="Cash on Delivery"
        subtitle="Coming soon"
      />
    </div>
  );

  if (isMobile) return options;

  return (
    <div className="rounded-2xl border border-[#E4BEB8] bg-white p-4 shadow-sm">
      <h2 className="mb-4 font-sora text-2xl font-semibold text-[#1C1B1B]">Payment Method</h2>
      {options}
    </div>
  );
}

function PaymentOption({
  selected,
  onSelect,
  disabled = false,
  icon,
  title,
  subtitle,
}: {
  selected: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-xl border-2 p-4 text-left transition-colors",
        selected
          ? "border-[rgba(182,25,19,0.4)] bg-[#F6F3F2]"
          : "border-[#E5E2E1] bg-white hover:border-[rgba(182,25,19,0.25)]",
        disabled && "cursor-not-allowed opacity-55 hover:border-[#E5E2E1]",
      )}
    >
      <span className="flex min-w-0 items-center gap-4">
        <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded bg-[#E5E2E1]">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block font-inter text-sm font-semibold text-[#1C1B1B]">{title}</span>
          <span className="block font-inter text-xs text-[#5B403C]">{subtitle}</span>
        </span>
      </span>

      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-[#B61913]" : "border-[#D5D0CF]",
        )}
      >
        {selected && <Check className="size-3 text-[#B61913]" />}
      </span>
    </button>
  );
}
