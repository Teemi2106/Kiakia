"use client";

import { useActionState } from "react";
import { cancelWalletWithdrawalAction, type WalletWithdrawalState } from "@/app/actions/wallet-withdrawals";

const initialState: WalletWithdrawalState = {};

export function CancelWithdrawalButton({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(cancelWalletWithdrawalAction, initialState);

  return (
    <form action={action} className="mt-3 flex flex-col items-start gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-kk-line px-3 py-1.5 font-inter text-xs font-semibold text-kk-cocoa transition-colors hover:border-kk-red/50 hover:text-kk-red-ink disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Cancelling…" : "Cancel request"}
      </button>
      {state.error && <span role="alert" className="font-inter text-xs text-kk-danger-ink">{state.error}</span>}
    </form>
  );
}
