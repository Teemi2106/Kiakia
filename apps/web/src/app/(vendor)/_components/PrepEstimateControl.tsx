"use client";

import { updatePrepEstimateAction } from "@/app/actions/vendor-delivery";
import { extendedReadyMinutes, parseReadyInMinutes, PREP_EXTENSION_MINUTES } from "@/lib/vendor/prep-estimate";
import { Button, Input } from "@kiakia/ui";
import { Timer } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";

/**
 * "Need more time?" for an order still being prepared. Quick buttons add 5, 10
 * or 15 minutes to the current ready time; or the store types "ready in N
 * minutes" (1 to 180). The rider search and the assigned rider follow the new
 * time. Shown only for accepted/preparing rider-delivery orders (the caller
 * decides; the database refuses anything else).
 */
export function PrepEstimateControl({ orderId, expectedReadyAt }: { orderId: string; expectedReadyAt: string | null }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function send(minutes: number) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await updatePrepEstimateAction(orderId, minutes);
      if (result.ok) {
        setMessage(result.message ?? null);
        setTyped("");
        setOpen(false);
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  function submitTyped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseReadyInMinutes(typed);
    if (parsed.ok) send(parsed.minutes);
    else setError(parsed.error);
  }

  return (
    <div className="flex flex-col gap-3">
      {!open && (
        <div>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setOpen(true)}>
            <Timer className="size-4" aria-hidden="true" />
            Need more time?
          </Button>
        </div>
      )}
      {open && (
        <div className="flex flex-col gap-3 rounded-xl border border-kk-line bg-kk-card p-4">
          <p className="text-sm font-semibold text-kk-ink">Need more time?</p>
          <p className="text-sm text-kk-cocoa">Tell us so the rider arrives when the food is ready, not before.</p>
          {expectedReadyAt && (
            <div className="flex flex-wrap gap-2">
              {PREP_EXTENSION_MINUTES.map((extra) => (
                <Button
                  key={extra}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const minutes = extendedReadyMinutes(expectedReadyAt, extra, Date.now());
                    if (minutes !== null) send(minutes);
                  }}
                >
                  +{extra} min
                </Button>
              ))}
            </div>
          )}
          <form onSubmit={submitTyped} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`ready-in-${orderId}`} className="text-sm font-medium text-kk-ink">
                Or: ready in how many minutes from now?
              </label>
              <Input
                id={`ready-in-${orderId}`}
                name="minutes"
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                placeholder="1 to 180"
                disabled={pending}
                value={typed}
                onChange={(event) => setTyped(event.target.value.replace(/\D/g, ""))}
              />
            </div>
            <Button type="submit" size="sm" loading={pending} disabled={pending || typed === ""}>
              Update
            </Button>
          </form>
          <div>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="rounded-2xl border border-kk-green/30 bg-kk-green-wash px-4 py-3 text-sm font-medium text-kk-ink">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-kk-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
