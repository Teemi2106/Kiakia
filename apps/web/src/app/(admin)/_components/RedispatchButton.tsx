"use client";

import { redispatchOrderAction } from "@/app/actions/admin-dispatch";
import type { FormState } from "@/lib/admin/action-helpers";
import { Button } from "@kiakia/ui";
import { startTransition, useActionState, useState, type FormEvent } from "react";

/**
 * "Send to riders again" for an order that has no rider. Asks first,
 * disables itself while the request runs (a second click cannot send twice),
 * and shows the result in words: "Asking 1 rider now", "A rider is already being asked" or "No riders in range".
 */
export function RedispatchButton({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(redispatchOrderAction, {});
  const [asking, setAsking] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    setAsking(false);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      {asking && !pending ? (
        <div className="flex flex-col gap-2 rounded-control border border-border px-3 py-2 text-sm text-ink">
          <p>Ask riders for this order again? The nearest rider who can take it is asked now, using the current settings. If a rider is already being asked, nothing changes. It does not move any money.</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Yes, send it
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" size="sm" loading={pending} disabled={pending} onClick={() => setAsking(true)}>
            Send to riders again
          </Button>
        </div>
      )}
      {state.error && !pending && (
        <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.success && !pending && (
        <p role="status" className="rounded-control bg-positive-surface px-3 py-2 text-sm text-ink">
          {state.message}
        </p>
      )}
    </form>
  );
}
