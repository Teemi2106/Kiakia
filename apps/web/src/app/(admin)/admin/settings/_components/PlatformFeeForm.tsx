"use client";

import { setPlatformFeeAction } from "@/app/actions/admin-settings";
import { platformFeeExample, type PlatformFeeInfo } from "@/lib/admin/platform-fee-info";
import { Input } from "@kiakia/ui";
import { useState } from "react";
import { AdminActionForm } from "../../../_components/AdminActionForm";
import { Field } from "../../../_components/Field";
import { formatPercent, money } from "../../../_components/format";

/** "2" for 200 bps, "2.5" for 250 bps. */
function percentInputValue(bps: number): string {
  return String(bps / 100);
}

/** Percent as typed ("2.5") to bps, or null while it is not a valid percentage. */
function typedBps(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value.trim())) return null;
  return Math.round(Number(value) * 100);
}

export function PlatformFeeForm({ fee, currentBps }: { fee: PlatformFeeInfo; currentBps: number }) {
  const [typed, setTyped] = useState(percentInputValue(currentBps));
  const bps = typedBps(typed);
  const preview =
    bps === null ? "Enter a percentage, for example 2 or 2.5." : bps > fee.maxBps ? `The highest allowed is ${formatPercent(fee.maxBps)}.` : `If you save: ${platformFeeExample(fee.key, bps, money)}`;

  return (
    <AdminActionForm
      action={setPlatformFeeAction}
      submitLabel="Save fee"
      reason={{ required: true, label: "Why are you changing it?" }}
      confirmLabel="I understand this changes how much money moves on new orders, and it does not change orders already placed."
    >
      <input type="hidden" name="key" value={fee.key} />
      <Field label="New rate (percent)" htmlFor={`percent-${fee.key}`}>
        <Input
          id={`percent-${fee.key}`}
          name="percent"
          inputMode="decimal"
          required
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>
      <p className="text-sm text-ink-muted" aria-live="polite">
        {preview}
      </p>
    </AdminActionForm>
  );
}
