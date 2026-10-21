import { renderTemplate } from "@/lib/messaging/templates";

/**
 * Shows the message as a sample person would get it. Everything is rendered as
 * plain text (React escapes it, whitespace is kept): nothing an admin types is
 * ever treated as HTML.
 */
export function MessagePreview({
  channel,
  subject,
  body,
  sampleFirstName,
  sampleStoreName,
}: {
  channel: "email" | "sms";
  subject: string;
  body: string;
  sampleFirstName: string;
  sampleStoreName: string;
}) {
  const values = { first_name: sampleFirstName, store_name: sampleStoreName };
  const renderedBody = renderTemplate(body, values);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-muted">
        Preview for a sample person ({sampleFirstName}
        {body.includes("store_name") ? `, ${sampleStoreName}` : ""})
      </p>
      <div className="rounded-card border border-border bg-surface p-4 text-sm text-ink">
        {channel === "email" && <p className="mb-2 break-words border-b border-border pb-2 font-semibold">{renderTemplate(subject, values) || "(no subject yet)"}</p>}
        <p className="whitespace-pre-wrap break-words">{renderedBody || <span className="text-ink-muted">Your message will appear here as you type.</span>}</p>
      </div>
    </div>
  );
}
