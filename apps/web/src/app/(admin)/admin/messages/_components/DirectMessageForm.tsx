"use client";

import { Button, Input, Select } from "@kiakia/ui";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { sendMessageAction, type SendState } from "@/app/actions/admin-messages";
import { CHANNEL_LABELS, type Channel } from "@/lib/messaging/audience";
import { REASON_MAX_CHARS } from "@/lib/messaging/limits";
import { firstNameOf } from "@/lib/messaging/templates";
import { Field } from "../../../_components/Field";
import { MessageFields } from "./MessageFields";
import { MessagePreview } from "./MessagePreview";

/**
 * "Send a message" on one person's page. Service messages only (no promotion
 * option exists here). The send button locks while the request is in flight.
 */
export function DirectMessageForm({ userId, personName }: { userId: string; personName: string | null }) {
  const [state, formAction, pending] = useActionState<SendState, FormData>(sendMessageAction, {});
  const [channel, setChannel] = useState<Channel>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const lock = useRef(false);
  const submissionId = useRef<string | null>(null);
  const channelId = useId();
  const reasonId = useId();

  useEffect(() => {
    lock.current = false; // the action answered; a new attempt is allowed
  }, [state]);

  // Clear the boxes once a message has gone, so it cannot be sent twice by accident.
  const [cleared, setCleared] = useState<SendState | null>(null);
  if (state.success && cleared !== state) {
    setCleared(state);
    setSubject("");
    setBody("");
    setReason("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || pending) return;
    lock.current = true;
    const formData = new FormData(event.currentTarget);
    if (state.success) submissionId.current = null; // the last one went; this is a new message
    submissionId.current ??= crypto.randomUUID();
    formData.set("submissionId", submissionId.current);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="channel" value={channel} />

      <Field label="How to send it" htmlFor={channelId}>
        <Select id={channelId} value={channel} onChange={(event) => setChannel(event.target.value as Channel)} className="max-w-60">
          {(Object.keys(CHANNEL_LABELS) as Channel[]).map((value) => (
            <option key={value} value={value}>
              {CHANNEL_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      <MessageFields channel={channel} subject={subject} body={body} onSubject={setSubject} onBody={setBody} allowStoreName={false} promotional={false} />

      <MessagePreview channel={channel} subject={subject} body={body} sampleFirstName={firstNameOf(personName) || "there"} sampleStoreName="" />

      <div className="flex flex-col gap-1">
        <label htmlFor={reasonId} className="text-sm font-medium text-ink">
          Why are you sending this?
        </label>
        <Input id={reasonId} name="reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={REASON_MAX_CHARS} required minLength={3} />
        <p className="text-xs text-ink-muted">Only admins see this. It is saved in the activity log.</p>
      </div>

      <p className="text-xs text-ink-muted">This is a service message, so it is sent even if the person has not agreed to promotions. It cannot be taken back once sent.</p>

      {state.error && (
        <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.success && !pending && (
        <p role="status" className="rounded-control bg-positive-surface px-3 py-2 text-sm text-ink">
          {state.message ?? "Message sent."}
        </p>
      )}

      <div>
        <Button type="submit" loading={pending} disabled={pending}>
          Send message
        </Button>
      </div>
    </form>
  );
}
