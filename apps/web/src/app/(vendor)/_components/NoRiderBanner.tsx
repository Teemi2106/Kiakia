"use client";

import { expandRiderSearchAction, startSelfDeliveryAction } from "@/app/actions/vendor-delivery";
import { riderStatusLines, searchHasStarted } from "@/lib/vendor/dispatch-progress";
import {
  bannerQuestion,
  expandLabel,
  formatCountdown,
  NO_RIDER_HEADLINE,
  SEARCHING_WIDER,
  SELF_DELIVERY_CONFIRM_TEXT,
  type VendorDispatchState,
} from "@/lib/vendor/self-delivery";
import { Button } from "@kiakia/ui";
import { useNowMs } from "@/lib/vendor/use-now";
import { Clock, TriangleAlert } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

/** Where the rider search stands, in the store's words (see lib/vendor/dispatch-progress.ts). */
function StatusLines({ lines }: { lines: readonly string[] }) {
  const [headline, ...rest] = lines;
  if (!headline) return null;
  return (
    <div role="status" className="flex gap-3 rounded-2xl border border-[#E4BEB8] bg-white p-4">
      <Clock className="mt-0.5 size-5 shrink-0 text-[#934B00]" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-[#1C1B1B]">{headline}</p>
        {rest.map((line) => (
          <p key={line} className="text-sm text-[#5B403C]">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Everything the store is told about finding a rider. While no rider is in
 * range (state = 'no_rider_nearby') it is an alert with two choices: look further
 * away (up to the store's own delivery distance), or deliver it yourself. In every
 * other state it shows a status line instead: searching one rider at a time,
 * the search starting later, or a rider on the way. It stays mounted while any
 * dispatch state exists, so the result of "Look further away" is still readable
 * once the state moves on. The actions revalidate the page, so the alert goes
 * away on its own once a rider accepts or self-delivery starts. The countdown is
 * local (one timer, only while the button is rate-limited); there is no polling.
 */
export function NoRiderBanner({ orderId, status, dispatch }: { orderId: string; status: string; dispatch: VendorDispatchState }) {
  const nowMs = useNowMs(dispatch.asOfMs);
  const [pending, startTransition] = useTransition();
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The countdown: the server's seconds (or the retry time from a refusal) minus
  // the seconds that have passed since we last heard from the server. A fresh
  // server value resets it (adjusting state while rendering, not in an effect).
  const [base, setBase] = useState(dispatch.expandAvailableInSeconds);
  const [elapsed, setElapsed] = useState(0);
  if (base !== dispatch.expandAvailableInSeconds && dispatch.expandAvailableInSeconds !== 0) {
    setBase(dispatch.expandAvailableInSeconds);
    setElapsed(0);
  }
  const remaining = Math.max(0, base - elapsed);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [remaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- restart the timer only when the countdown starts or stops

  // Once the search went out the server state moves on (offers pending) and the
  // choice is gone, but the vendor still gets to read what happened.
  if (dispatch.state !== "no_rider_nearby") {
    const lines = riderStatusLines(dispatch, status, nowMs);
    if (lines.length === 0 && !message) return null;
    return (
      <div className="flex flex-col gap-3">
        <StatusLines lines={lines} />
        {message && (
          <p role="status" className="rounded-2xl border border-[#176A22]/30 bg-[#DFF3DC] px-4 py-3 text-sm font-medium text-[#1C1B1B]">
            {message}
          </p>
        )}
      </div>
    );
  }

  const rateLimited = remaining > 0;
  // Look further away is offered only when the server says it is possible (a
  // first-round distance is set and the store delivers further than that), or while its countdown runs,
  // and never before the rider search has started (the database refuses it then).
  const showExpand = (dispatch.canExpand || rateLimited) && searchHasStarted(dispatch, status, nowMs);
  const expandDisabled = pending || rateLimited;

  function expand() {
    setError(null);
    setMessage(null);
    setSearching(true);
    startTransition(async () => {
      const result = await expandRiderSearchAction(orderId);
      setSearching(false);
      if (result.ok) setMessage(result.message ?? null);
      else {
        setError(result.error ?? "Something went wrong. Please try again.");
        if (result.retryInSeconds) {
          setBase(result.retryInSeconds);
          setElapsed(0);
        }
      }
    });
  }

  function startSelfDelivery() {
    setError(null);
    setMessage(null);
    setConfirming(false);
    startTransition(async () => {
      const result = await startSelfDeliveryAction(orderId);
      if (!result.ok) setError(result.error ?? "Something went wrong. Please try again.");
    });
  }

  return (
    <div role="alert" className="rounded-2xl border-2 border-[#934B00] bg-[#FFDCC5]/40 p-4 sm:p-5">
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-[#934B00]" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <p className="font-sora text-base font-bold text-[#1C1B1B]">{NO_RIDER_HEADLINE}</p>
            <p className="mt-1 text-sm text-[#5B403C]">{bannerQuestion({ ...dispatch, expandAvailableInSeconds: remaining })}</p>
          </div>

          {confirming ? (
            <div role="alertdialog" aria-label="Deliver this order yourself?" className="flex flex-col gap-3 rounded-xl border border-[#E4BEB8] bg-white p-4">
              <p className="text-sm font-semibold text-[#1C1B1B]">Deliver this order yourself?</p>
              <p className="text-sm text-[#5B403C]">{SELF_DELIVERY_CONFIRM_TEXT}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={startSelfDelivery}>
                  Yes, I&apos;ll deliver it
                </Button>
                <Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {showExpand && (
                <Button type="button" disabled={expandDisabled} loading={searching} onClick={expand}>
                  {searching ? SEARCHING_WIDER : rateLimited ? `Look further away (try again in ${formatCountdown(remaining)})` : expandLabel(dispatch)}
                </Button>
              )}
              <Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirming(true)}>
                I&apos;ll deliver it myself
              </Button>
            </div>
          )}

          {!showExpand && (
            <p className="text-xs text-[#5B403C]">We are already looking as far as we can for this order. You can keep waiting, or deliver it yourself.</p>
          )}
          {message && (
            <p role="status" className="text-sm font-medium text-[#1C1B1B]">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm font-medium text-[#BA1A1A]">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
