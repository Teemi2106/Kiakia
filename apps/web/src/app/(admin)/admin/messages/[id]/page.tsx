import { getBroadcast } from "@/lib/admin/messages";
import { requireAdminContext } from "@/lib/auth/dal";
import { CATEGORY_LABELS, CHANNEL_LABELS } from "@/lib/messaging/audience";
import { Badge, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateTime } from "../../../_components/format";
import { PageHeader } from "../../../_components/PageHeader";
import { Fields, Section } from "../../../_components/Section";
import { Table, Td, Th, Tr } from "../../../_components/Table";
import { BroadcastAutoRefresh } from "../_components/BroadcastAutoRefresh";
import { BroadcastStatus } from "../_components/BroadcastStatus";

export const metadata: Metadata = { title: "Message" };

const MAX_FAILURES = 20;

export default async function AdminMessageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminContext();

  const { id } = await params;
  const message = await getBroadcast(id);
  if (!message) notFound();

  const { counts } = message;
  const sending = counts.waiting > 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {/* Only mounted while messages are still going out; once everything has settled it is gone, so polling stops by itself. */}
      {sending && <BroadcastAutoRefresh />}

      <PageHeader
        title={message.subject ?? "Text message"}
        description={`${CHANNEL_LABELS[message.channel]} · ${CATEGORY_LABELS[message.category]} · ${formatDateTime(message.createdAt)}${message.createdByName ? ` · sent by ${message.createdByName}` : ""}`}
        actions={<BroadcastStatus counts={counts} />}
      />

      <Link href="/admin/messages" className="-mt-3 text-sm text-brand-600 hover:underline">
        Back to all messages
      </Link>

      {sending && (
        <p role="status" className="rounded-control bg-[#FFDCC5] px-3 py-2 text-sm text-kk-orange-deep">
          This message is still going out. The numbers below update by themselves every few seconds.
        </p>
      )}

      <Section title="What was sent">
        <div className="flex flex-col gap-4">
          <Fields
            items={[
              { label: "Sent to", value: message.audienceLabel },
              { label: "Type", value: <Badge tone={message.category === "promotional" ? "warning" : "neutral"}>{CATEGORY_LABELS[message.category]}</Badge> },
            ]}
          />
          <div className="rounded-card border border-border bg-surface p-4 text-sm text-ink">
            {message.subject && <p className="mb-2 break-words border-b border-border pb-2 font-semibold">{message.subject}</p>}
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </div>
        </div>
      </Section>

      <Section title="How it went">
        <Fields
          items={[
            { label: "People it was meant for", value: counts.recipients },
            { label: "Waiting to be sent", value: counts.waiting },
            { label: "Sent", value: counts.sent },
            { label: "Delivered", value: counts.delivered },
            { label: "Failed", value: counts.failed },
            { label: "Skipped", value: counts.skipped },
          ]}
        />
        <p className="mt-3 text-xs text-ink-muted">
          Skipped means the person was left out on purpose, for example no email or phone number on file, they have not agreed to promotions, or their account is suspended.
        </p>
      </Section>

      <Section title="Messages that did not arrive">
        {message.failures.length === 0 ? (
          <EmptyState title={counts.failed > 0 ? "No details available" : "Nothing has failed"} description={counts.failed > 0 ? "The reasons for these failures could not be loaded." : undefined} />
        ) : (
          <div className="flex flex-col gap-2">
            <Table
              head={
                <>
                  <Th>Person</Th>
                  <Th>What went wrong</Th>
                </>
              }
            >
              {message.failures.map((failure, index) => (
                <Tr key={`${failure.displayName}-${index}`}>
                  <Td>{failure.displayName}</Td>
                  <Td>{failure.reason}</Td>
                </Tr>
              ))}
            </Table>
            {counts.failed > message.failures.length && (
              <p className="text-xs text-ink-muted">
                Showing the first {Math.min(MAX_FAILURES, message.failures.length)} of {counts.failed} that failed.
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
