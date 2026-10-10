"use client";

import type { FormState } from "@/lib/admin/action-helpers";
import { Button, Textarea, type ButtonProps } from "@kiakia/ui";
import { startTransition, useActionState, useId, useState, type FormEvent } from "react";

/**
 * Form for the bound id admin actions (approve/reject/reset). Adds the confirm
 * step, an optional reason and a pending state, and shows the message the
 * action returns on failure. Submits through onSubmit, not the form's `action`
 * prop, so React does not reset a half-typed reason when the server rejects it.
 */
export function ConfirmedAction({
  action,
  submitLabel,
  variant,
  confirmLabel,
  reasonLabel,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  variant?: ButtonProps["variant"];
  /** Adds a checkbox that must be ticked before the button enables. */
  confirmLabel?: string;
  /** Adds an optional reason textarea with this label. */
  reasonLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [confirmed, setConfirmed] = useState(false);
  const reasonId = useId();
  const confirmId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {reasonLabel && (
        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className="text-sm font-medium text-ink">
            {reasonLabel} <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <Textarea id={reasonId} name="reason" maxLength={1000} className="min-h-16" />
        </div>
      )}
      {confirmLabel && (
        <label htmlFor={confirmId} className="flex items-start gap-2 text-sm text-ink">
          <input
            id={confirmId}
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>{confirmLabel}</span>
        </label>
      )}
      {state.error && (
        <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" variant={variant} loading={pending} disabled={pending || (confirmLabel ? !confirmed : false)}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
