"use client";

import { setDispatchSettingAction } from "@/app/actions/admin-dispatch";
import { dispatchInputValue, dispatchPreviewFor, type DispatchSettingInfo, type DispatchSettingsValues } from "@/lib/admin/dispatch-settings-info";
import { Input } from "@kiakia/ui";
import { useState } from "react";
import { AdminActionForm } from "../../../_components/AdminActionForm";
import { Field } from "../../../_components/Field";

export function DispatchSettingForm({ info, currentValue, current }: { info: DispatchSettingInfo; currentValue: number; current: DispatchSettingsValues }) {
  const [typed, setTyped] = useState(dispatchInputValue(info.key, currentValue));
  const preview = dispatchPreviewFor(info, typed, current);

  return (
    <AdminActionForm
      action={setDispatchSettingAction}
      submitLabel="Save"
      reason={{ required: true, label: "Why are you changing it?" }}
      submitDisabled={preview.problem}
      confirmLabel="I understand this applies to orders from now on, and offers already sent are unchanged."
    >
      <input type="hidden" name="key" value={info.key} />
      <Field label={info.inputLabel} htmlFor={`dispatch-${info.key}`}>
        <Input id={`dispatch-${info.key}`} name="value" inputMode="decimal" required value={typed} onChange={(event) => setTyped(event.target.value)} />
      </Field>
      <p className={preview.problem ? "text-sm text-danger" : "text-sm text-ink-muted"} aria-live="polite">
        {preview.text}
      </p>
    </AdminActionForm>
  );
}
