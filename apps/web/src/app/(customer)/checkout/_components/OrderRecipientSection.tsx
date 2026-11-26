"use client";

import { Gift, UserRound } from "lucide-react";

interface OrderRecipientSectionProps {
  orderForSomeoneElse: boolean;
  onOrderForSomeoneElseChange: (value: boolean) => void;
  contactPhone: string;
  onContactPhoneChange: (value: string) => void;
  recipientName: string;
  onRecipientNameChange: (value: string) => void;
  recipientPhone: string;
  onRecipientPhoneChange: (value: string) => void;
  stepNumber?: number;
}

export function OrderRecipientSection({
  orderForSomeoneElse,
  onOrderForSomeoneElseChange,
  contactPhone,
  onContactPhoneChange,
  recipientName,
  onRecipientNameChange,
  recipientPhone,
  onRecipientPhoneChange,
  stepNumber,
}: OrderRecipientSectionProps) {
  const optionClass = (selected: boolean) =>
    `flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left font-inter text-sm font-semibold transition-colors ${
      selected
        ? "border-kk-red bg-kk-red/5 text-kk-red-ink"
        : "border-kk-hair bg-kk-card text-kk-ink hover:border-kk-red/50"
    }`;

  return (
    <section
      data-order-recipient-section
      className="col-span-3 rounded-2xl border border-kk-hair bg-kk-card p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex items-start gap-3">
        {stepNumber && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-kk-red/10 font-inter text-sm font-semibold text-kk-red-ink">
            {stepNumber}
          </span>
        )}
        <div>
          <h2 className="font-sora text-lg font-semibold text-kk-ink">Who’s receiving this order?</h2>
          <p className="mt-1 font-inter text-sm text-kk-cocoa">
            Choose who the rider should contact at delivery.
          </p>
        </div>
      </div>

      <div role="group" aria-label="Who is this order for?" className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={!orderForSomeoneElse}
          onClick={() => onOrderForSomeoneElseChange(false)}
          className={optionClass(!orderForSomeoneElse)}
        >
          <UserRound className="size-5 shrink-0" />
          For me
        </button>
        <button
          type="button"
          aria-pressed={orderForSomeoneElse}
          onClick={() => onOrderForSomeoneElseChange(true)}
          className={optionClass(orderForSomeoneElse)}
        >
          <Gift className="size-5 shrink-0" />
          For someone else
        </button>
      </div>

      {orderForSomeoneElse ? (
        <div className="mt-4 rounded-xl bg-kk-cream p-4">
          <p className="font-inter text-sm font-semibold text-kk-ink">Their delivery details</p>
          <p className="mt-1 font-inter text-xs leading-5 text-kk-cocoa">
            The rider will contact them. You’ll pay for the order and can track it from your account.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block font-inter text-sm font-semibold text-kk-ink">
              Their name
              <input
                name="recipientName"
                type="text"
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
                value={recipientName}
                onChange={(event) => onRecipientNameChange(event.target.value)}
                placeholder="Full name"
                className="mt-2 w-full rounded-xl border border-kk-hair bg-kk-card px-4 py-3 font-inter text-sm font-normal text-kk-ink placeholder:text-kk-cocoa focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red/20"
              />
            </label>
            <label className="block font-inter text-sm font-semibold text-kk-ink">
              Their phone number
              <input
                name="recipientPhone"
                type="tel"
                required
                autoComplete="tel"
                value={recipientPhone}
                onChange={(event) => onRecipientPhoneChange(event.target.value)}
                placeholder="0801 234 5678"
                className="mt-2 w-full rounded-xl border border-kk-hair bg-kk-card px-4 py-3 font-inter text-sm font-normal text-kk-ink placeholder:text-kk-cocoa focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red/20"
              />
            </label>
          </div>
        </div>
      ) : (
        <label className="mt-4 block max-w-xl font-inter text-sm font-semibold text-kk-ink">
          Your phone number
          <input
            name="contactPhone"
            type="tel"
            required
            autoComplete="tel"
            value={contactPhone}
            onChange={(event) => onContactPhoneChange(event.target.value)}
            placeholder="0801 234 5678"
            className="mt-2 w-full rounded-xl border border-kk-hair bg-kk-cream px-4 py-3 font-inter text-sm font-normal text-kk-ink placeholder:text-kk-cocoa focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red/20"
          />
          <span className="mt-1.5 block font-inter text-xs font-normal text-kk-cocoa">
            The rider will use this number if they need to reach you.
          </span>
        </label>
      )}
    </section>
  );
}
