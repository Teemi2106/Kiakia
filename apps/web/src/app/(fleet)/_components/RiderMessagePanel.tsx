"use client";

import { sendFleetMessageAction, type FleetMessageState } from "@/app/actions/fleet";
import { FLEET_MESSAGE_MAX_CHARS } from "@/lib/validation/fleet";
import { Badge, Button, Textarea, type BadgeTone } from "@kiakia/ui";
import { MessageSquare } from "lucide-react";
import { useActionState, useState } from "react";

/** A rider row, flattened to what the table prints (the page does the formatting). */
export interface RiderRow {
  readonly userId: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly vehicleType: string | null;
  readonly status: "delivering" | "available" | "no_signal" | "offline";
  readonly statusLabel: string;
  readonly deliveryText: string | null;
  readonly lastSeen: string;
}

const TONES: Record<RiderRow["status"], BadgeTone> = {
  delivering: "warning",
  available: "positive",
  no_signal: "neutral",
  offline: "neutral",
};

const initialState: FleetMessageState = {};

export function RiderMessagePanel({ riders }: { riders: readonly RiderRow[] }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [body, setBody] = useState("");

  // The text box empties once the message has gone; a failed send keeps it so nothing is retyped.
  const [state, formAction, pending] = useActionState(async (previous: FleetMessageState, formData: FormData) => {
    const result = await sendFleetMessageAction(previous, formData);
    if (result.queued !== undefined) setBody("");
    return result;
  }, initialState);

  const ids = new Set(riders.map((rider) => rider.userId));
  // A rider can leave the fleet between refreshes; never submit an id that is no longer listed.
  const chosen = [...selected].filter((id) => ids.has(id));
  const reachable = riders.filter((rider) => rider.status === "available" || rider.status === "delivering");

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">{chosen.length} selected</span>
        <button type="button" onClick={() => setSelected(new Set(reachable.map((rider) => rider.userId)))} className="text-brand-600 hover:underline">
          Select everyone online
        </button>
        <button type="button" onClick={() => setSelected(new Set(riders.map((rider) => rider.userId)))} className="text-brand-600 hover:underline">
          Select all
        </button>
        {chosen.length > 0 && (
          <button type="button" onClick={() => setSelected(new Set())} className="text-ink-muted hover:text-ink">
            Clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface-raised shadow-sm">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="border-b border-border bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th scope="col" className="w-10 px-4 py-2.5">
                <span className="sr-only">Select</span>
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">Rider</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Current delivery</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {riders.map((rider) => (
              <tr key={rider.userId} className="hover:bg-surface-sunken/60">
                <td className="px-4 py-3 align-top">
                  <input
                    type="checkbox"
                    name="riderId"
                    value={rider.userId}
                    checked={selected.has(rider.userId)}
                    onChange={() => toggle(rider.userId)}
                    aria-label={`Select ${rider.fullName}`}
                    className="size-4 accent-brand-500"
                  />
                </td>
                <td className="px-4 py-3 align-top">
                  <p className="font-medium text-ink">{rider.fullName}</p>
                  <p className="text-xs text-ink-muted">{[rider.phone, rider.vehicleType].filter(Boolean).join(" · ") || "No details"}</p>
                </td>
                <td className="px-4 py-3 align-top">
                  <Badge tone={TONES[rider.status]}>{rider.statusLabel}</Badge>
                </td>
                <td className="px-4 py-3 align-top text-ink">{rider.deliveryText ?? <span className="text-ink-muted">—</span>}</td>
                <td className="px-4 py-3 align-top text-ink-muted">{rider.lastSeen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-card border border-border bg-surface-raised p-4 shadow-sm">
        <label htmlFor="fleet-message" className="flex items-center gap-2 text-sm font-medium text-ink">
          <MessageSquare className="size-4" aria-hidden="true" />
          Text the selected riders
        </label>
        <p className="mt-1 text-xs text-ink-muted">For example: &ldquo;Lots of orders around Wuse 2. Head there if you&apos;re free.&rdquo; It goes out as an SMS from KiaKia with your fleet name in front.</p>
        <Textarea
          id="fleet-message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={FLEET_MESSAGE_MAX_CHARS}
          className="mt-2 w-full"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pending} disabled={chosen.length === 0 || body.trim().length < 2}>
            Send to {chosen.length || "…"} {chosen.length === 1 ? "rider" : "riders"}
          </Button>
          <span className="text-xs text-ink-muted">{body.length}/{FLEET_MESSAGE_MAX_CHARS}</span>
        </div>
        <div aria-live="polite" className="mt-2 text-sm">
          {state.error && <p className="text-danger">{state.error}</p>}
          {state.queued === 0 && (
            <p className="text-ink-muted">
              Nothing was sent. The same message went to these riders a moment ago, or none of them can receive texts.
            </p>
          )}
          {state.queued !== undefined && state.queued > 0 && state.chosen !== undefined && (
            <p className="text-kk-green">
              {state.queued === state.chosen
                ? `Sent to ${state.queued} ${state.queued === 1 ? "rider" : "riders"}.`
                : `Sent to ${state.queued} of ${state.chosen}. The rest have no phone number or are suspended.`}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
