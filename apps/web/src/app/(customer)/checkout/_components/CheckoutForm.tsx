// app/(customer)/checkout/_components/CheckoutForm.tsx
"use client";

import { Gift, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { placeOrderAction, type CheckoutFormState } from "@/app/actions/orders";
import { useDeliveryFeeEstimate } from "@/lib/checkout/useDeliveryFeeEstimate";
import { CheckoutDesktop } from "./CheckoutDesktop";
import { CheckoutMobile } from "./CheckoutMobile";
import type { Address, CartItem, Vendor, PaymentMethod } from "./types";

interface CheckoutFormProps {
  vendor: Vendor | null;
  items: CartItem[];
  addresses: Address[];
  defaultAddress: Address | null;
  subtotalKobo: number;
  /** Live service fee for this subtotal, computed server-side from the admin-set rate; null if it could not be read. */
  serviceFeeKobo: number | null;
  walletBalanceKobo: number;
  /** profiles.phone as of page load — prefills the required contact-phone
   * field so a returning customer isn't retyping it every order. */
  customerPhone: string | null;
}

const initialState: CheckoutFormState = {};

export function CheckoutForm({
  vendor,
  items,
  addresses,
  defaultAddress,
  subtotalKobo,
  serviceFeeKobo,
  walletBalanceKobo,
  customerPhone,
}: CheckoutFormProps) {
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(
    defaultAddress,
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [useWallet, setUseWallet] = useState(false);
  const [orderForSomeoneElse, setOrderForSomeoneElse] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [contactPhone, setContactPhone] = useState(customerPhone ?? "");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [showFriendOrderPrompt, setShowFriendOrderPrompt] = useState(false);
  const [formState, formAction, pending] = useActionState(
    placeOrderAction,
    initialState,
  );

  useEffect(() => {
    if (orderForSomeoneElse) return;
    try {
      if (window.sessionStorage.getItem("kk-friend-order-prompt-dismissed") === "1") return;
    } catch {
      // If storage is blocked, show the prompt for this visit.
    }
    const timer = window.setTimeout(() => setShowFriendOrderPrompt(true), 2200);
    return () => window.clearTimeout(timer);
  }, [orderForSomeoneElse]);

  function dismissFriendOrderPrompt() {
    try {
      window.sessionStorage.setItem("kk-friend-order-prompt-dismissed", "1");
    } catch {
      // The prompt still closes for the current page view.
    }
    setShowFriendOrderPrompt(false);
  }

  function startFriendOrder() {
    dismissFriendOrderPrompt();
    setOrderForSomeoneElse(true);
    window.setTimeout(() => {
      const section = Array.from(
        document.querySelectorAll<HTMLElement>("[data-order-recipient-section]"),
      ).find((element) => element.getClientRects().length > 0);
      section?.scrollIntoView({ behavior: "smooth", block: "center" });
      section?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    }, 50);
  }

  function changeOrderRecipient(value: boolean) {
    if (value) dismissFriendOrderPrompt();
    setOrderForSomeoneElse(value);
  }

  // If no address is selected, use the first available
  const activeAddress = selectedAddress || addresses[0] || null;

  // No manual useMemo here — the React Compiler auto-memoizes these (see
  // AGENTS.md: this Next.js version's conventions differ from pre-compiler
  // React), and a hand-written dependency array listing only the two
  // numeric fields is exactly what the compiler flags as unpreservable
  // manual memoization. Whether or not the compiler actually holds this
  // object reference stable across every render doesn't matter to
  // useDeliveryFeeEstimate() any more, though — it keys its own effect on
  // these coordinates' primitive values, not on this object's identity.
  const vendorLatLng =
    vendor?.location_lat != null && vendor?.location_lng != null
      ? { lat: vendor.location_lat, lng: vendor.location_lng }
      : null;
  const destinationLatLng =
    activeAddress?.location_lat != null && activeAddress?.location_lng != null
      ? { lat: activeAddress.location_lat, lng: activeAddress.location_lng }
      : null;
  const deliveryFeeEstimate = useDeliveryFeeEstimate(vendorLatLng, destinationLatLng, subtotalKobo);

  return (
    <>
      <div className="hidden lg:block">
        <CheckoutDesktop
          vendor={vendor}
          items={items}
          addresses={addresses}
          selectedAddress={activeAddress}
          onAddressChange={setSelectedAddress}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          useWallet={useWallet}
          onUseWalletChange={setUseWallet}
          subtotalKobo={subtotalKobo}
          serviceFeeKobo={serviceFeeKobo}
          walletBalanceKobo={walletBalanceKobo}
          deliveryFeeEstimate={deliveryFeeEstimate}
          deliveryNote={deliveryNote}
          onDeliveryNoteChange={setDeliveryNote}
          contactPhone={contactPhone}
          onContactPhoneChange={setContactPhone}
          orderForSomeoneElse={orderForSomeoneElse}
          onOrderForSomeoneElseChange={changeOrderRecipient}
          recipientName={recipientName}
          onRecipientNameChange={setRecipientName}
          recipientPhone={recipientPhone}
          onRecipientPhoneChange={setRecipientPhone}
          formAction={formAction}
          formState={formState}
          pending={pending}
        />
      </div>
      <div className="lg:hidden">
        <CheckoutMobile
          vendor={vendor}
          items={items}
          addresses={addresses}
          selectedAddress={activeAddress}
          onAddressChange={setSelectedAddress}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          useWallet={useWallet}
          onUseWalletChange={setUseWallet}
          subtotalKobo={subtotalKobo}
          serviceFeeKobo={serviceFeeKobo}
          walletBalanceKobo={walletBalanceKobo}
          deliveryFeeEstimate={deliveryFeeEstimate}
          deliveryNote={deliveryNote}
          onDeliveryNoteChange={setDeliveryNote}
          contactPhone={contactPhone}
          onContactPhoneChange={setContactPhone}
          orderForSomeoneElse={orderForSomeoneElse}
          onOrderForSomeoneElseChange={changeOrderRecipient}
          recipientName={recipientName}
          onRecipientNameChange={setRecipientName}
          recipientPhone={recipientPhone}
          onRecipientPhoneChange={setRecipientPhone}
          formAction={formAction}
          formState={formState}
          pending={pending}
        />
      </div>
      {showFriendOrderPrompt && !orderForSomeoneElse && (
        <aside className="fixed bottom-28 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-kk-line bg-kk-card p-4 text-kk-ink shadow-[0_18px_50px_-16px_rgba(35,20,18,0.45)] lg:bottom-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-kk-red/10 text-kk-red-ink">
              <Gift className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-sora text-sm font-semibold">Sending a meal to someone?</h2>
              <p className="mt-1 font-inter text-xs leading-5 text-kk-cocoa">
                Add their name and number so the rider can deliver it straight to them.
              </p>
            </div>
            <button
              type="button"
              onClick={dismissFriendOrderPrompt}
              aria-label="Dismiss friend order prompt"
              className="rounded-lg p-1.5 text-kk-cocoa hover:bg-kk-sand"
            >
              <X className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={startFriendOrder}
            className="mt-3 w-full rounded-xl bg-kk-red px-4 py-2.5 font-inter text-sm font-semibold text-white hover:bg-kk-red-deep"
          >
            Set up their delivery
          </button>
        </aside>
      )}
    </>
  );
}
