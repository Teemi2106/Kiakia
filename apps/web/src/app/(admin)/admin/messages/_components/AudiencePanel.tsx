import type { AudiencePreview } from "@/lib/admin/messages-map";
import { roleLabel } from "../../../_components/labels";

/** "Who will get this": how many people, who is left out and why, and a few example names. */
export function AudiencePanel({
  preview,
  channel,
  loading,
  error,
  promotional,
}: {
  preview: AudiencePreview | null;
  channel: "email" | "sms";
  loading: boolean;
  error: string | null;
  promotional: boolean;
}) {
  return (
    <div className="flex flex-col gap-2" aria-live="polite" aria-busy={loading}>
      <h3 className="text-sm font-medium text-ink">Who will get this</h3>
      {error ? (
        <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : !preview ? (
        <p className="text-sm text-ink-muted">{loading ? "Counting…" : "Choose who to send to and we will count them."}</p>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <p className="text-sm text-ink">
            <span className="text-2xl font-semibold">{preview.recipientCount}</span>{" "}
            {preview.recipientCount === 1 ? "person" : "people"} will get this {channel === "email" ? "email" : "text message"}.
          </p>

          {preview.suppressedCount > 0 && (
            <div className="mt-2 text-sm text-ink-muted">
              <p>{preview.suppressedCount} will be skipped:</p>
              <ul className="ml-5 list-disc">
                {preview.noAddress > 0 && (
                  <li>
                    {preview.noAddress} {channel === "email" ? "have no email address on file" : "have no phone number on file"}
                  </li>
                )}
                {preview.noConsent > 0 && <li>{preview.noConsent} have not agreed to promotions</li>}
                {preview.suspended > 0 && <li>{preview.suspended} have a suspended account</li>}
              </ul>
            </div>
          )}
          {promotional && <p className="mt-1 text-xs text-ink-muted">People who have not agreed to promotions are always skipped.</p>}

          {preview.sample.length > 0 && (
            <div className="mt-2 text-sm text-ink-muted">
              <p>For example:</p>
              <ul className="ml-5 list-disc">
                {preview.sample.map((person) => (
                  <li key={person.userId || person.displayName}>
                    {person.displayName}
                    {person.role ? ` (${roleLabel(person.role)})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
