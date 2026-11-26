"use client";

import { useActionState } from "react";
import { Badge } from "@kiakia/ui";
import { reviewCustomerWalletWithdrawalAction } from "@/app/actions/admin-wallet-withdrawals";
import { MaskedAccountNumber } from "../../../_components/MaskedAccountNumber";
import { money } from "../../../_components/format";

interface WithdrawalRequest {
  readonly id: string;
  readonly customerName: string | null;
  readonly amountKobo: number;
  readonly bankName: string;
  readonly accountName: string;
  readonly accountNumber: string;
  readonly maskedAccountNumber: string;
  readonly status: string;
  readonly reviewReason: string | null;
  readonly externalReference: string | null;
  readonly createdAt: string;
}

export function CustomerWithdrawalReview({ request }: { request: WithdrawalRequest }) {
  const [state, action, pending] = useActionState(reviewCustomerWalletWithdrawalAction, {});
  const isOpen = request.status === "pending" || request.status === "approved";

  return (
    <li className="rounded-card border border-border bg-surface-raised p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">{request.customerName || "Customer"}</p>
          <Badge className="mt-1">Customer wallet</Badge>
          <p className="mt-2 text-sm text-ink-muted">{request.bankName} · {request.accountName}</p>
          <p className="mt-1 text-sm text-ink-muted">
            Account <MaskedAccountNumber masked={request.maskedAccountNumber} fullNumber={request.accountNumber} />
          </p>
          <p className="mt-1 text-xs text-ink-muted">Requested {new Date(request.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</p>
          {request.externalReference && <p className="mt-1 text-xs text-ink-muted">Bank reference: {request.externalReference}</p>}
          {request.reviewReason && <p className="mt-2 text-sm text-ink-muted">Review note: {request.reviewReason}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Requested</p>
          <p className="text-xl font-semibold text-ink">{money(request.amountKobo)}</p>
          <Badge className="mt-2">{request.status === "pending" ? "Pending review" : request.status === "approved" ? "Approved · reserved" : request.status}</Badge>
        </div>
      </div>

      {isOpen && (
        <form action={action} className="mt-4 border-t border-border pt-4">
          <input type="hidden" name="requestId" value={request.id} />
          {request.status === "approved" && (
            <label className="block text-sm font-medium text-ink">
              Bank transfer reference
              <input
                name="externalReference"
                type="text"
                minLength={3}
                maxLength={100}
                pattern="[A-Za-z0-9._-]{3,100}"
                autoComplete="off"
                className="mt-1 min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:max-w-md"
                placeholder="Enter after the transfer is complete"
              />
            </label>
          )}
          <label className="mt-3 block text-sm font-medium text-ink">
            Review note <span className="font-normal text-ink-muted">(required when rejecting)</span>
            <input
              name="reason"
              type="text"
              maxLength={500}
              className="mt-1 min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:max-w-md"
              placeholder="Optional for approval"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {request.status === "pending" && (
              <button
                type="submit"
                name="decision"
                value="approve"
                disabled={pending}
                className="inline-flex min-h-10 items-center justify-center rounded-control bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60"
              >
                Approve request
              </button>
            )}
            {request.status === "approved" && (
              <button
                type="submit"
                name="decision"
                value="mark_paid"
                disabled={pending}
                className="inline-flex min-h-10 items-center justify-center rounded-control bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60"
              >
                {pending ? "Saving…" : "Mark paid after transfer"}
              </button>
            )}
            <button
              type="submit"
              name="decision"
              value="reject"
              disabled={pending}
              className="inline-flex min-h-10 items-center justify-center rounded-control border border-border bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-sunken disabled:cursor-wait disabled:opacity-60"
            >
              Reject and release funds
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">Approval keeps the amount reserved. Only mark it paid after the bank transfer is complete.</p>
          {state.error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{state.error}</p>}
          {state.success && <p role="status" className="mt-3 text-sm font-medium text-positive">{state.message}</p>}
        </form>
      )}
    </li>
  );
}
