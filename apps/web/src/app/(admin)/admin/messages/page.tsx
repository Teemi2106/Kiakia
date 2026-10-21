import { listBroadcasts, previewAudience } from "@/lib/admin/messages";
import { isSuperadmin, requireAdminContext } from "@/lib/auth/dal";
import { CATEGORY_LABELS, CHANNEL_LABELS } from "@/lib/messaging/audience";
import { Badge, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { pageParam, type SearchParams } from "../../_components/search-params";
import { Section } from "../../_components/Section";
import { Table, Td, Th, Tr } from "../../_components/Table";
import { BroadcastAutoRefresh } from "./_components/BroadcastAutoRefresh";
import { BroadcastStatus } from "./_components/BroadcastStatus";
import { ComposeForm } from "./_components/ComposeForm";

export const metadata: Metadata = { title: "Messages" };

export default async function AdminMessagesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const raw = await searchParams;

  // One wave: the history, the count for the form's starting choice, and the role check.
  const [history, initialPreview, canSendPromotions] = await Promise.all([
    listBroadcasts({ page: pageParam(raw.page) }),
    previewAudience({ kind: "role", role: "customer", segment: "all" }, "email", "transactional").catch(() => null),
    isSuperadmin(),
  ]);

  const stillSending = history.rows.some((row) => row.counts.waiting > 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Messages"
        description="Send an email or text message to customers, vendors or riders, or to one person. Everything you send is kept in the message history below."
      />

      <ComposeForm initialPreview={initialPreview} canSendPromotions={canSendPromotions} />

      <Section title="Message history">
        {history.rows.length === 0 ? (
          <EmptyState title="Nothing sent yet" description="Messages you send will be listed here, with how many were delivered." />
        ) : (
          <div className="flex flex-col gap-4">
            {stillSending && <BroadcastAutoRefresh />}
            <Table
              head={
                <>
                  <Th>Sent</Th>
                  <Th>Message</Th>
                  <Th>To</Th>
                  <Th className="text-right">People</Th>
                  <Th className="text-right">Sent</Th>
                  <Th className="text-right">Delivered</Th>
                  <Th className="text-right">Failed</Th>
                  <Th className="text-right">Skipped</Th>
                  <Th>Status</Th>
                </>
              }
            >
              {history.rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/admin/messages/${row.id}`} className="text-brand-600 hover:underline">
                      {formatDateTime(row.createdAt)}
                    </Link>
                    {row.createdByName && <p className="text-xs text-ink-muted">by {row.createdByName}</p>}
                  </Td>
                  <Td className="max-w-xs">
                    <div className="mb-1 flex flex-wrap gap-1">
                      <Badge>{CHANNEL_LABELS[row.channel]}</Badge>
                      {row.category === "promotional" && <Badge tone="warning">{CATEGORY_LABELS.promotional}</Badge>}
                    </div>
                    {row.subject && <p className="truncate font-medium">{row.subject}</p>}
                    <p className="line-clamp-2 break-words text-ink-muted">{row.body}</p>
                  </Td>
                  <Td>{row.audienceLabel}</Td>
                  <Td className="text-right">{row.counts.recipients}</Td>
                  <Td className="text-right">{row.counts.sent}</Td>
                  <Td className="text-right">{row.counts.delivered}</Td>
                  <Td className="text-right">{row.counts.failed}</Td>
                  <Td className="text-right">{row.counts.skipped}</Td>
                  <Td>
                    <BroadcastStatus counts={row.counts} />
                  </Td>
                </Tr>
              ))}
            </Table>
            <Pagination basePath="/admin/messages" params={{}} page={history.page} pageSize={history.pageSize} total={history.total} />
          </div>
        )}
      </Section>
    </div>
  );
}
