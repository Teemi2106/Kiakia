import { isSuperadmin, requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { buttonVariants, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { formatDateTime } from "../../_components/format";
import { type SearchParams, pageParam } from "../../_components/search-params";
import { Table, Td, Th, Tr } from "../../_components/Table";
import { LaunchAnnouncementPanel, type LaunchCampaignSummary } from "./LaunchAnnouncementPanel";

export const metadata: Metadata = { title: "Launch subscribers" };

const PAGE_SIZE = 50;

export default async function LaunchSubscribersPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAdminContext();
  const raw = await searchParams;
  const page = pageParam(raw.page);
  const from = (page - 1) * PAGE_SIZE;
  const admin = createAdminClient();
  const [{ data, count, error }, { data: previewData, error: previewError }, superadmin] = await Promise.all([
    admin.from("launch_subscribers")
      .select("id, email, consented_at", { count: "exact" })
      .is("unsubscribed_at", null)
      .order("consented_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    admin.rpc("admin_launch_announcement_preview", { p_actor_id: session.userId }),
    isSuperadmin(),
  ]);

  if (error) throw new Error("Could not load launch subscribers.");
  if (previewError) throw new Error("Could not load launch announcement status.");
  const preview = previewData as {
    eligible_count?: number;
    campaign?: LaunchCampaignSummary | null;
  };
  const total = count ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader
        title="Launch subscribers"
        description="People who asked KiaKia to send the launch announcement and relevant pre-launch updates. Export includes a personal unsubscribe link for every address."
        actions={<Link href="/admin/launch-subscribers/export" className={buttonVariants({ variant: "primary" })}>Export subscriber list</Link>}
      />

      <LaunchAnnouncementPanel
        eligibleCount={typeof preview.eligible_count === "number" ? preview.eligible_count : 0}
        campaign={preview.campaign ?? null}
        isSuperadmin={superadmin}
      />

      {total === 0 ? (
        <EmptyState title="No launch subscribers yet" description="Opted-in email addresses will appear here." />
      ) : (
        <Table head={<><Th>Email address</Th><Th>Consent recorded</Th></>}>
          {(data ?? []).map((subscriber) => (
            <Tr key={subscriber.id}>
              <Td><span className="font-medium text-ink">{subscriber.email}</span></Td>
              <Td>{formatDateTime(subscriber.consented_at)}</Td>
            </Tr>
          ))}
        </Table>
      )}
      <Pagination basePath="/admin/launch-subscribers" params={{}} page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}
