import { listRiders } from "@/lib/admin/riders";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Button, EmptyState, Select } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Field } from "../../_components/Field";
import { formatDateTime, humanize } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";
import { StatusPill } from "../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../_components/Table";

export const metadata: Metadata = { title: "Riders" };

export default async function AdminRidersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const raw = await searchParams;
  const kyc = firstParam(raw.kyc);
  const availability = firstParam(raw.availability);
  const riders = await listRiders({ kycStatus: kyc, availability, page: pageParam(raw.page) });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader title="Riders" description="Review KYC documents and approve riders before they can take deliveries." />

      <form method="get" action="/admin/riders" className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-3">
        <Field label="KYC status" htmlFor="kyc">
          <Select id="kyc" name="kyc" defaultValue={kyc ?? ""}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
        </Field>
        <Field label="Availability" htmlFor="availability">
          <Select id="availability" name="availability" defaultValue={availability ?? ""}>
            <option value="">All</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit">Filter</Button>
          <Link href="/admin/riders" className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
            Reset
          </Link>
        </div>
      </form>

      {riders.rows.length === 0 ? (
        <EmptyState title="No riders match" />
      ) : (
        <Table
          head={
            <>
              <Th>Rider</Th>
              <Th>KYC</Th>
              <Th>Documents to review</Th>
              <Th>Vehicle</Th>
              <Th>Availability</Th>
              <Th>Joined</Th>
            </>
          }
        >
          {riders.rows.map((rider) => (
            <Tr key={rider.userId}>
              <Td>
                <Link href={`/admin/riders/${rider.userId}`} className="font-medium text-brand-600 hover:underline">
                  {rider.fullName ?? rider.userId}
                </Link>
                <p className="text-xs text-ink-muted">{rider.phone ?? "No phone"}</p>
              </Td>
              <Td>
                <StatusPill status={rider.kycStatus} />
              </Td>
              <Td>{rider.documentsPending > 0 ? <Badge tone="warning">{rider.documentsPending}</Badge> : "—"}</Td>
              <Td>
                {rider.vehicleType ? humanize(rider.vehicleType) : "—"}
                {rider.plateNumber && <p className="text-xs text-ink-muted">{rider.plateNumber}</p>}
              </Td>
              <Td>
                <Badge tone={rider.isOnline ? "positive" : "neutral"}>{rider.isOnline ? "Online" : "Offline"}</Badge>
              </Td>
              <Td>{formatDateTime(rider.createdAt)}</Td>
            </Tr>
          ))}
        </Table>
      )}

      <Pagination
        basePath="/admin/riders"
        params={{ kyc, availability }}
        page={riders.page}
        pageSize={riders.pageSize}
        total={riders.total}
      />
    </div>
  );
}
