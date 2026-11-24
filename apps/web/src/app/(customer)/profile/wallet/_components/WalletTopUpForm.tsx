"use client";

import { useActionState } from "react";
import { startWalletTopUpAction, type WalletTopUpState } from "@/app/actions/wallet";

const initialState: WalletTopUpState = {};

export function WalletTopUpForm() {
  const [state, action, pending] = useActionState(startWalletTopUpAction, initialState);

  return (
    <form action={action} className="mt-5 rounded-2xl border border-kk-line bg-kk-card p-5 shadow-sm sm:p-6">
      <h2 className="font-sora text-lg font-semibold text-kk-ink">Add money</h2>
      <p className="mt-1 font-inter text-sm text-kk-cocoa">
        Fund your wallet securely through Monnify. Add between ₦100 and ₦500,000 per top-up.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label className="flex-1 font-inter text-sm font-semibold text-kk-ink">
          Amount in naira
          <span className="mt-2 flex items-center rounded-xl border border-kk-hair bg-kk-sand px-4 focus-within:border-kk-red focus-within:ring-2 focus-within:ring-kk-red/20">
            <span className="mr-2 text-kk-cocoa">₦</span>
            <input
              name="amountNaira"
              type="number"
              min={100}
              max={500000}
              step={1}
              inputMode="numeric"
              required
              className="min-w-0 flex-1 bg-transparent py-3 font-inter text-sm font-normal text-kk-ink outline-none"
              placeholder="1,000"
            />
          </span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="mt-auto inline-flex min-h-12 items-center justify-center rounded-xl bg-kk-red px-5 py-3 font-inter text-sm font-semibold text-white transition-colors hover:bg-kk-red-hover disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Preparing payment…" : "Fund wallet"}
        </button>
      </div>
      {state.error && <p role="alert" className="mt-3 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
