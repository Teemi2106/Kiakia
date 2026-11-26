"use client";

import { useActionState } from "react";
import { requestWalletWithdrawalAction, type WalletWithdrawalState } from "@/app/actions/wallet-withdrawals";

const initialState: WalletWithdrawalState = {};

export function WalletWithdrawalForm({ availableKobo, requestKey }: { availableKobo: number; requestKey: string }) {
  const [state, action, pending] = useActionState(requestWalletWithdrawalAction, initialState);
  const maxNaira = (availableKobo / 100).toFixed(2);

  return (
    <form action={action} className="mt-5 rounded-2xl border border-kk-line bg-kk-card p-5 shadow-sm sm:p-6">
      <h2 className="font-sora text-lg font-semibold text-kk-ink">Request a withdrawal</h2>
      <p className="mt-1 font-inter text-sm leading-6 text-kk-cocoa">
        Requests are reviewed by KiaKia and are not instant. The amount stays reserved while a request is pending or approved.
      </p>

      <input type="hidden" name="requestKey" value={requestKey} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="font-inter text-sm font-semibold text-kk-ink sm:col-span-2">
          Amount in naira
          <span className="mt-2 flex items-center rounded-xl border border-kk-hair bg-kk-sand px-4 focus-within:border-kk-red focus-within:ring-2 focus-within:ring-kk-red/20">
            <span className="mr-2 text-kk-cocoa">₦</span>
            <input
              name="amountNaira"
              type="number"
              min="0.01"
              max={maxNaira}
              step="0.01"
              inputMode="decimal"
              required
              disabled={availableKobo <= 0}
              className="min-w-0 flex-1 bg-transparent py-3 font-inter text-sm font-normal text-kk-ink outline-none disabled:opacity-60"
              placeholder="1,000.00"
            />
          </span>
          <span className="mt-1 block text-xs font-normal text-kk-cocoa">Up to {new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(availableKobo / 100)} available.</span>
        </label>

        <label className="font-inter text-sm font-semibold text-kk-ink">
          Bank name
          <input
            name="bankName"
            type="text"
            autoComplete="off"
            maxLength={80}
            required
            disabled={availableKobo <= 0}
            className="mt-2 min-h-12 w-full rounded-xl border border-kk-hair bg-kk-sand px-4 font-inter text-sm font-normal text-kk-ink outline-none focus:border-kk-red focus:ring-2 focus:ring-kk-red/20 disabled:opacity-60"
            placeholder="Bank"
          />
        </label>
        <label className="font-inter text-sm font-semibold text-kk-ink">
          Account holder name
          <input
            name="accountName"
            type="text"
            autoComplete="name"
            maxLength={100}
            required
            disabled={availableKobo <= 0}
            className="mt-2 min-h-12 w-full rounded-xl border border-kk-hair bg-kk-sand px-4 font-inter text-sm font-normal text-kk-ink outline-none focus:border-kk-red focus:ring-2 focus:ring-kk-red/20 disabled:opacity-60"
            placeholder="Name on the account"
          />
        </label>
        <label className="font-inter text-sm font-semibold text-kk-ink sm:col-span-2">
          10-digit account number
          <input
            name="accountNumber"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            minLength={10}
            maxLength={10}
            pattern="[0-9]{10}"
            required
            disabled={availableKobo <= 0}
            className="mt-2 min-h-12 w-full rounded-xl border border-kk-hair bg-kk-sand px-4 font-inter text-sm font-normal tracking-[0.12em] text-kk-ink outline-none focus:border-kk-red focus:ring-2 focus:ring-kk-red/20 disabled:opacity-60"
            placeholder="••••••••••"
          />
        </label>
      </div>

      {state.error && <p role="alert" className="mt-3 font-inter text-sm font-medium text-kk-danger-ink">{state.error}</p>}
      <button
        type="submit"
        disabled={pending || availableKobo <= 0}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-kk-red px-5 py-3 font-inter text-sm font-semibold text-white transition-colors hover:bg-kk-red-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Submitting request…" : "Submit withdrawal request"}
      </button>
    </form>
  );
}
