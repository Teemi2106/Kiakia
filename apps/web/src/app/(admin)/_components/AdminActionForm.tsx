"use client";

import type { FormState } from "@/lib/admin/action-helpers";
import { Button, Textarea, type ButtonProps } from "@kiakia/ui";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

interface AdminActionFormProps {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  variant?: ButtonProps["variant"];
  /** Extra fields: hidden ids, selects, number inputs. */
  children?: ReactNode;
  /** Adds a reason textarea; "required" marks it so. */
  reason?: { name?: string; label?: string; required?: boolean };
  /** Adds a checkbox that must be ticked before the submit button enables. */
  confirmLabel?: string;
  /**
   * Error messages to render in a warning tone: the action's main effect
   * succeeded and only a follow-up is unconfirmed, so "failed" styling would mislead.
   */
  warningErrors?: readonly string[];
  /** Keeps the submit button off while the typed input is known to be wrong. */
  submitDisabled?: boolean;
}

/**
 * Form for the FormState admin actions. Submits through onSubmit rather than
 * the form's `action` prop because React resets an action form after every
 * submission, which would wipe a half-typed reason when the server rejects it;
 * here the form is only reset on success.
 */
export function AdminActionForm({ action, submitLabel, variant, children, reason, confirmLabel, warningErrors, submitDisabled }: AdminActionFormProps) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [confirmed, setConfirmed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const reasonId = useId();
  const confirmId = useId();

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} onReset={() => setConfirmed(false)} className="flex flex-col gap-3">
      {children}

      {reason && (
        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className="text-sm font-medium text-ink">
            {reason.label ?? "Reason"}
            {!reason.required && <span className="font-normal text-ink-muted"> (optional)</span>}
          </label>
          <Textarea
            id={reasonId}
            name={reason.name ?? "reason"}
            required={reason.required}
            minLength={reason.required ? 3 : undefined}
            maxLength={1000}
            className="min-h-16"
          />
        </div>
      )}

      {confirmLabel && (
        <label htmlFor={confirmId} className="flex items-start gap-2 text-sm text-ink">
          <input
            id={confirmId}
            type="checkbox"
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>{confirmLabel}</span>
        </label>
      )}

      {state.error &&
        (warningErrors?.includes(state.error) ? (
          <p role="alert" className="rounded-control bg-[#FFDCC5] px-3 py-2 text-sm text-kk-orange-deep">
            {state.error}
          </p>
        ) : (
          <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm text-danger">
            {state.error}
          </p>
        ))}
      {state.success && !pending && (
        <p role="status" className="rounded-control bg-positive-surface px-3 py-2 text-sm text-ink">
          {state.message ?? "Done."}
        </p>
      )}

      <div>
        <Button type="submit" variant={variant} loading={pending} disabled={pending || submitDisabled === true || (confirmLabel ? !confirmed : false)}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
