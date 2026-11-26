"use client";

import { useActionState } from "react";
import {
  startLaunchAnnouncementAction,
  type LaunchAnnouncementActionState,
} from "@/app/actions/launch-admin";

const EMPTY_STATE: LaunchAnnouncementActionState = {};

export interface LaunchCampaignSummary {
  id: string;
  status: string;
  approved_at: string;
  recipient_count: number;
  pending_count: number;
  sent_count: number;
  failed_count: number;
  suppressed_count: number;
  completed_at: string | null;
}

export function LaunchAnnouncementPanel({
  eligibleCount,
  campaign,
  isSuperadmin,
}: {
  eligibleCount: number;
  campaign: LaunchCampaignSummary | null;
  isSuperadmin: boolean;
}) {
  const [state, formAction, pending] = useActionState(startLaunchAnnouncementAction, EMPTY_STATE);

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-sm" aria-labelledby="launch-announcement-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="launch-announcement-title" className="text-lg font-semibold text-ink">Launch announcement</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Countdown completion never sends email. A superadmin must approve this one-time announcement here.
          </p>
        </div>
        <p className="shrink-0 rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink">
          Eligible now: <strong>{eligibleCount}</strong>
        </p>
      </div>

      {campaign ? (
        <div className="mt-4 rounded-control border border-line bg-surface-sunken p-4 text-sm text-ink">
          <p className="font-semibold">Campaign {campaign.status}</p>
          <p className="mt-1 text-ink-muted">
            {campaign.sent_count} sent · {campaign.pending_count} pending · {campaign.failed_count} failed · {campaign.suppressed_count} suppressed
            {" "}of {campaign.recipient_count} approved recipients.
          </p>
          <p className="mt-2 text-xs text-ink-muted">Approved {new Date(campaign.approved_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}.</p>
        </div>
      ) : eligibleCount === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No active subscribers have consented to the launch announcement.</p>
      ) : isSuperadmin ? (
        <form action={formAction} className="mt-5 grid gap-4 border-t border-line pt-4">
          <div className="rounded-control border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
            Approving queues one email for each of the <strong>{eligibleCount}</strong> active, consented addresses above. The queue will check unsubscribe status again before delivery.
          </div>
          <label className="grid gap-1 text-sm font-medium text-ink" htmlFor="launch-approval-phrase">
            Type <code className="rounded bg-surface-sunken px-1">ANNOUNCE KIAKIA</code> to confirm
            <input
              id="launch-approval-phrase"
              name="phrase"
              autoComplete="off"
              required
              className="h-11 rounded-control border border-line bg-surface px-3 font-normal outline-none focus:border-brand-500"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input name="confirm" type="checkbox" value="yes" required className="mt-1 accent-brand-600" />
            <span>I approve sending the launch announcement to the eligible subscriber count shown above.</span>
          </label>
          <input type="hidden" name="expectedRecipientCount" value={eligibleCount} />
          {state.message && (
            <p className={state.status === "error" ? "text-sm text-danger-700" : "text-sm text-emerald-700"} role={state.status === "error" ? "alert" : "status"}>
              {state.message}{state.recipientCount ? ` (${state.recipientCount} recipients.)` : ""}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 w-fit rounded-control bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Queueing announcement…" : "Approve and queue announcement"}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">A superadmin must approve the one-time announcement.</p>
      )}
    </section>
  );
}
