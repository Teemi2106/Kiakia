"use client";

import { Button, Input, Select } from "@kiakia/ui";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { previewAudienceAction, searchPeopleAction, sendBroadcastAction, type PersonHit, type SendState } from "@/app/actions/admin-messages";
import type { AudiencePreview } from "@/lib/admin/messages-map";
import {
  CHANNEL_LABELS,
  ROLE_LABELS,
  SEGMENTS_BY_ROLE,
  SEGMENT_LABELS,
  type Audience,
  type AudienceRole,
  type Channel,
} from "@/lib/messaging/audience";
import { REASON_MAX_CHARS, REASON_MIN_CHARS } from "@/lib/messaging/limits";
import { smsStats, segmentLabel } from "@/lib/messaging/sms";
import { firstNameOf } from "@/lib/messaging/templates";
import { Field } from "../../../_components/Field";
import { Section } from "../../../_components/Section";
import { AudiencePanel } from "./AudiencePanel";
import { MessageFields } from "./MessageFields";
import { MessagePreview } from "./MessagePreview";

type Purpose = "transactional" | "promotional";
type Step = "edit" | "confirm";

const DEFAULT_ROLE: AudienceRole = "customer";

/**
 * Writes one message to a group of people. Three steps in one form: write it,
 * check who gets it (counted by the database), then confirm. The send button is
 * only reachable from the confirm step, locks the moment it is pressed, and a
 * one-time id travels with the form so a repeated submit does not send twice.
 */
export function ComposeForm(props: { initialPreview: AudiencePreview | null; canSendPromotions: boolean }) {
  // "Write another message" remounts the form, which resets every field and the action's result in one go.
  const [round, setRound] = useState(0);
  return <ComposeFormInner key={round} {...props} onAgain={() => setRound((n) => n + 1)} />;
}

function ComposeFormInner({
  initialPreview,
  canSendPromotions,
  onAgain,
}: {
  initialPreview: AudiencePreview | null;
  canSendPromotions: boolean;
  onAgain: () => void;
}) {
  const [state, formAction, pending] = useActionState<SendState, FormData>(sendBroadcastAction, {});
  const [step, setStep] = useState<Step>("edit");

  const [channel, setChannel] = useState<Channel>("email");
  const [purpose, setPurpose] = useState<Purpose>("transactional");
  const [kind, setKind] = useState<"role" | "user">("role");
  const [role, setRole] = useState<AudienceRole>(DEFAULT_ROLE);
  const [segment, setSegment] = useState("all");
  const [person, setPerson] = useState<PersonHit | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const audience: Audience | null = useMemo(() => {
    if (kind === "user") return person ? { kind: "user", user_id: person.id } : null;
    return { kind: "role", role, segment };
  }, [kind, person, role, segment]);

  // ---- "Who will get this" -------------------------------------------------
  const [preview, setPreview] = useState<AudiencePreview | null>(initialPreview);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const requestId = useRef(0);

  // Counts again whenever the admin changes who, how or what kind. Driven by the change handlers
  // (not an effect), so nothing is fetched on mount: the page already counted the starting choice.
  function refreshPreview(next: { audience: Audience | null; channel: Channel; purpose: Purpose }) {
    const id = ++requestId.current;
    if (!next.audience) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    void previewAudienceAction({ audience: next.audience, channel: next.channel, category: next.purpose }).then((result) => {
      if (id !== requestId.current) return; // a newer choice is already being counted
      setPreviewLoading(false);
      if (result.error || !result.preview) {
        setPreviewError(result.error ?? "We could not work out who would get this.");
        setPreview(null);
      } else {
        setPreviewError(null);
        setPreview(result.preview);
      }
    });
  }

  function changeChannel(value: Channel) {
    setChannel(value);
    refreshPreview({ audience, channel: value, purpose });
  }

  function changePurpose(value: Purpose) {
    setPurpose(value);
    refreshPreview({ audience, channel, purpose: value });
  }

  function changeWho(value: string) {
    if (value === "user") {
      setKind("user");
      setPerson(null);
      refreshPreview({ audience: null, channel, purpose });
    } else {
      const nextRole = value as AudienceRole;
      setKind("role");
      setRole(nextRole);
      setSegment("all");
      refreshPreview({ audience: { kind: "role", role: nextRole, segment: "all" }, channel, purpose });
    }
  }

  function changeSegment(value: string) {
    setSegment(value);
    refreshPreview({ audience: { kind: "role", role, segment: value }, channel, purpose });
  }

  function pickPerson(next: PersonHit | null) {
    setPerson(next);
    refreshPreview({ audience: next ? { kind: "user", user_id: next.id } : null, channel, purpose });
  }

  // ---- Send ----------------------------------------------------------------
  // Made at send time (not in render) so server and browser markup agree; reused if the same form is sent again.
  const submissionId = useRef<string | null>(null);
  const sendLock = useRef(false);

  useEffect(() => {
    sendLock.current = false; // the action answered; a new attempt is allowed
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Pressing Enter in a text box must never send: only the confirm button does.
    if (step !== "confirm" || sendLock.current || pending || state.success) return;
    sendLock.current = true;
    const formData = new FormData(event.currentTarget);
    submissionId.current ??= crypto.randomUUID();
    formData.set("submissionId", submissionId.current);
    startTransition(() => formAction(formData));
  }

  function review() {
    const problem = validate();
    setLocalError(problem);
    if (!problem) setStep("confirm");
  }

  function validate(): string | null {
    if (!audience) return "Choose the person to send to.";
    if (channel === "email" && !subject.trim()) return "Add a subject for the email.";
    if (!body.trim()) return "Write the message.";
    if (reason.trim().length < REASON_MIN_CHARS) return "Say why you are sending this (at least 3 characters). It is saved in the activity log.";
    if (previewLoading) return "Still counting who will get this. Try again in a moment.";
    if (!preview) return previewError ?? "We could not work out who would get this.";
    if (preview.recipientCount === 0) return "Nobody would get this message. Change who it goes to.";
    return null;
  }

  const sampleName = kind === "user" && person ? firstNameOf(person.name) || "Ada" : preview?.sample[0] ? firstNameOf(preview.sample[0].displayName) || "Ada" : "Ada";
  const channelWord = channel === "email" ? "email" : "text message";
  const count = preview?.recipientCount ?? 0;

  const channelId = useId();
  const audienceId = useId();
  const segmentId = useId();
  const reasonId = useId();

  if (state.success) {
    return (
      <Section title="Send a message">
        <div role="status" className="flex flex-col gap-3 rounded-control bg-positive-surface px-3 py-3 text-sm text-ink">
          <p>{state.message ?? "Your message is on its way."}</p>
          <div className="flex flex-wrap gap-2">
            {state.broadcastId && (
              <Link href={`/admin/messages/${state.broadcastId}`} className="inline-flex h-10 items-center rounded-control bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600">
                See how it is going
              </Link>
            )}
            <Button type="button" variant="secondary" onClick={onAgain}>
              Write another message
            </Button>
          </div>
        </div>
      </Section>
    );
  }

  const locked = step === "confirm";

  return (
    <Section title="Send a message">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <input type="hidden" name="audience" value={audience ? JSON.stringify(audience) : ""} />
        <input type="hidden" name="channel" value={channel} />
        <input type="hidden" name="category" value={purpose} />

        <fieldset inert={locked} className={`flex min-w-0 flex-col gap-5 ${locked ? "opacity-70" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How to send it" htmlFor={channelId}>
              <Select id={channelId} value={channel} onChange={(event) => changeChannel(event.target.value as Channel)}>
                {(Object.keys(CHANNEL_LABELS) as Channel[]).map((value) => (
                  <option key={value} value={value}>
                    {CHANNEL_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">What kind of message is it?</span>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="radio" name="purpose-choice" checked={purpose === "transactional"} onChange={() => changePurpose("transactional")} className="mt-0.5 size-4" />
                <span>
                  Service message
                  <span className="block text-xs text-ink-muted">About someone&apos;s orders, account or how KiaKia works. Sent even if they have not agreed to promotions.</span>
                </span>
              </label>
              <label className={`flex items-start gap-2 text-sm ${canSendPromotions ? "text-ink" : "text-ink-muted"}`}>
                <input
                  type="radio"
                  name="purpose-choice"
                  checked={purpose === "promotional"}
                  disabled={!canSendPromotions}
                  onChange={() => changePurpose("promotional")}
                  className="mt-0.5 size-4"
                />
                <span>
                  Promotion
                  <span className="block text-xs text-ink-muted">
                    {canSendPromotions
                      ? "Offers and news. People who have not agreed to promotions are skipped. Promotional texts are sent between 8am and 8pm."
                      : "Only a superadmin can send promotions. Ask a superadmin to send this for you."}
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who gets this" htmlFor={audienceId}>
              <Select
                id={audienceId}
                value={kind === "user" ? "user" : role}
                onChange={(event) => changeWho(event.target.value)}
              >
                {(Object.keys(ROLE_LABELS) as AudienceRole[]).map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
                <option value="user">One specific person</option>
              </Select>
            </Field>

            {kind === "role" ? (
              <Field label="Which ones" htmlFor={segmentId}>
                <Select id={segmentId} value={segment} onChange={(event) => changeSegment(event.target.value)}>
                  {SEGMENTS_BY_ROLE[role].map((value) => (
                    <option key={value} value={value}>
                      {SEGMENT_LABELS[role][value]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <PersonPicker person={person} onPick={pickPerson} />
            )}
          </div>

          <MessageFields
            channel={channel}
            subject={subject}
            body={body}
            onSubject={setSubject}
            onBody={setBody}
            allowStoreName={kind === "role" && role === "vendor"}
            promotional={purpose === "promotional"}
          />

          <div className="flex flex-col gap-1">
            <label htmlFor={reasonId} className="text-sm font-medium text-ink">
              Why are you sending this?
            </label>
            <Input
              id={reasonId}
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={REASON_MAX_CHARS}
              placeholder="For example: the app will be down for maintenance on Sunday"
            />
            <p className="text-xs text-ink-muted">Only admins see this. It is saved in the activity log.</p>
          </div>
        </fieldset>

        <div className="grid gap-5 rounded-card border border-border bg-surface-sunken/50 p-4 lg:grid-cols-2">
          <MessagePreview
            channel={channel}
            subject={subject}
            body={body}
            sampleFirstName={sampleName}
            sampleStoreName="Mama Put Kitchen"
          />
          <AudiencePanel preview={preview} channel={channel} loading={previewLoading} error={previewError} promotional={purpose === "promotional"} />
        </div>

        {step === "edit" && (
          <div className="flex flex-col gap-2">
            {localError && (
              <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm text-danger">
                {localError}
              </p>
            )}
            <div>
              <Button type="button" onClick={review}>
                Review and send
              </Button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div role="alertdialog" aria-labelledby="confirm-send-title" className="flex flex-col gap-3 rounded-card border border-border bg-surface-raised p-4">
            <h3 id="confirm-send-title" className="text-base font-semibold text-ink">
              Send this {channelWord} to {count} {count === 1 ? "person" : "people"}?
            </h3>
            <p className="text-sm text-ink">
              {purpose === "promotional" ? "This is a promotion. " : ""}
              {channel === "sms" ? `Each person is charged for ${segmentLabel(Math.max(1, smsStats(body).segments))} or more. ` : ""}
              Once you send it, it <strong>cannot be undone or taken back</strong>.
            </p>
            {state.error && (
              <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm text-danger">
                {state.error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" loading={pending} disabled={pending || count === 0}>
                Yes, send to {count} {count === 1 ? "person" : "people"}
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => setStep("edit")}>
                Go back and edit
              </Button>
            </div>
          </div>
        )}
      </form>
    </Section>
  );
}

function PersonPicker({ person, onPick }: { person: PersonHit | null; onPick: (person: PersonHit | null) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const turn = useRef(0);

  // Searches after the admin stops typing, never on mount.
  function onQuery(value: string) {
    setQuery(value);
    const mine = ++turn.current;
    if (value.trim().length < 2) {
      setHits([]);
      setSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    window.setTimeout(() => {
      if (mine !== turn.current) return;
      void searchPeopleAction(value).then((rows) => {
        if (mine !== turn.current) return;
        setHits(rows);
        setSearched(true);
        setSearching(false);
      });
    }, 300);
  }

  if (person) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink">Person</span>
        <div className="flex h-11 items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 text-sm text-ink">
          <span className="truncate">{person.name}</span>
          <button type="button" className="shrink-0 text-brand-600 hover:underline" onClick={() => onPick(null)}>
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Find the person (name or phone)
      </label>
      <Input id={id} value={query} onChange={(event) => onQuery(event.target.value)} autoComplete="off" />
      {searching && <p className="text-xs text-ink-muted">Searching…</p>}
      {!searching && searched && hits.length === 0 && <p className="text-xs text-ink-muted">Nobody found. Try a different name or phone number.</p>}
      {hits.length > 0 && (
        <ul className="divide-y divide-border rounded-control border border-border bg-surface text-sm">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-sunken" onClick={() => onPick(hit)}>
                <span className="truncate">{hit.name}</span>
                <span className="shrink-0 text-xs text-ink-muted">{hit.phone ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
