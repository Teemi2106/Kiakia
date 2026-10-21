"use client";

import { Button, Input, Textarea } from "@kiakia/ui";
import { useId } from "react";
import { EMAIL_BODY_MAX_CHARS, smsMaxChars, SUBJECT_MAX_CHARS, WORST_CASE_FIRST_NAME, WORST_CASE_STORE_NAME } from "@/lib/messaging/limits";
import { segmentLabel, smsStats } from "@/lib/messaging/sms";
import { mergeFieldToken, renderTemplate, type MergeField } from "@/lib/messaging/templates";
import { Field } from "../../../_components/Field";

/**
 * Subject (email only) and message text, with a length counter and buttons that
 * drop a merge field into the text. Controlled by the parent so a preview can
 * sit beside it. Field names (subject, body) are what the Server Actions read.
 */
export function MessageFields({
  channel,
  subject,
  body,
  onSubject,
  onBody,
  allowStoreName,
  promotional,
}: {
  channel: "email" | "sms";
  subject: string;
  body: string;
  onSubject: (value: string) => void;
  onBody: (value: string) => void;
  /** {{store_name}} only makes sense when writing to vendors. */
  allowStoreName: boolean;
  /** Promotions get an opt-out line added to a text, so the limit is lower. */
  promotional: boolean;
}) {
  const subjectId = useId();
  const bodyId = useId();
  const counterId = useId();

  function insert(field: MergeField) {
    const token = mergeFieldToken(field);
    // The shared Textarea does not forward a ref, so find the box by id.
    const element = document.getElementById(bodyId) as HTMLTextAreaElement | null;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    onBody(`${body.slice(0, start)}${token}${body.slice(end)}`);
    // Put the cursor after the inserted text once React has re-rendered the value.
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  // Counted the way the database checks it: with the longest first name (40) and store name (60) filled in.
  const longest = renderTemplate(body, { first_name: WORST_CASE_FIRST_NAME, store_name: WORST_CASE_STORE_NAME });
  const sms = channel === "sms" ? smsStats(longest) : null;
  const limit = channel === "sms" ? smsMaxChars(longest, promotional) : EMAIL_BODY_MAX_CHARS;
  const over = longest.length > limit;

  return (
    <div className="flex flex-col gap-4">
      {channel === "email" && (
        <Field label="Subject" htmlFor={subjectId}>
          <Input id={subjectId} name="subject" value={subject} onChange={(event) => onSubject(event.target.value)} maxLength={SUBJECT_MAX_CHARS} required />
        </Field>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={bodyId} className="text-sm font-medium text-ink">
            Message
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-muted">Insert:</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => insert("first_name")}>
              First name
            </Button>
            {allowStoreName && (
              <Button type="button" size="sm" variant="secondary" onClick={() => insert("store_name")}>
                Store name
              </Button>
            )}
          </div>
        </div>
        <Textarea
          id={bodyId}
          name="body"
          value={body}
          onChange={(event) => onBody(event.target.value)}
          aria-describedby={counterId}
          required
          className="min-h-36"
        />
        <p id={counterId} className={`text-xs ${over ? "text-danger" : "text-ink-muted"}`}>
          {longest.length} of {limit} characters
          {sms && sms.segments > 0 && <> · {segmentLabel(sms.segments)}</>}
          {sms?.encoding === "unicode" && <> · This text has special characters or emoji, so it is limited to {limit} characters and each text segment holds fewer (70 instead of 160).</>}
          {sms && promotional && <> · Promotions get an opt-out line added at the end. Promotional texts are sent between 8am and 8pm.</>}
          {over && <> · Too long. Please shorten it.</>}
        </p>
        <p className="text-xs text-ink-muted">
          {channel === "sms" ? "Each text segment is charged separately. " : ""}
          First name is filled in for each person
          {allowStoreName ? ", and store name for each vendor" : ""}. The count assumes the longest possible names, so it is never an underestimate. Write plain text only; formatting is shown exactly as typed.
        </p>
      </div>
    </div>
  );
}
