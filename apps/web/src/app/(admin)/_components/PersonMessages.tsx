import { listUserMessages } from "@/lib/admin/messages";
import { CATEGORY_LABELS, CHANNEL_LABELS, messageStatusLabel } from "@/lib/messaging/audience";
import { Badge, EmptyState } from "@kiakia/ui";
import { DirectMessageForm } from "../admin/messages/_components/DirectMessageForm";
import { formatDateTime } from "./format";
import { Section } from "./Section";
import { StatusPill } from "./StatusPill";

/**
 * "Send a message" plus "Recent messages" for one person, for the customer,
 * vendor and rider pages. An async Server Component the page wraps in
 * <Suspense>, so the message history loads beside the rest of the page instead
 * of holding it up. Text is rendered as plain text.
 */
export async function PersonMessages({ userId, personName }: { userId: string; personName: string | null }) {
  // A history that will not load must not take the send form down with it.
  const messages = await listUserMessages(userId, 10).catch((error: unknown) => {
    console.error("could not load recent messages", error instanceof Error ? error.message : "unknown");
    return null;
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Send a message">
        <DirectMessageForm userId={userId} personName={personName} />
      </Section>

      <Section title="Recent messages">
        {messages === null ? (
          <p className="text-sm text-ink-muted">Recent messages could not be loaded. Refresh the page to try again.</p>
        ) : messages.length === 0 ? (
          <EmptyState title="No messages yet" description="Messages sent to this person, including automatic ones, will be listed here." />
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {messages.map((message) => (
              <li key={message.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{CHANNEL_LABELS[message.channel]}</Badge>
                  {message.category === "promotional" && <Badge tone="warning">{CATEGORY_LABELS.promotional}</Badge>}
                  <StatusPill status={message.status} label={messageStatusLabel(message.status)} />
                  <span className="text-xs text-ink-muted">{formatDateTime(message.createdAt)}</span>
                </div>
                {message.subject && <p className="break-words font-medium text-ink">{message.subject}</p>}
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-ink-muted">{message.body}</p>
                {message.problem && <p className="text-xs text-danger">{message.problem}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
