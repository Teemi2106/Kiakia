import { listVendors } from "@/lib/admin/vendors";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Button, EmptyState, Input, Select } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Field } from "../../_components/Field";
import { formatDateTime, formatPercent, humanize } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";
import { StatusPill } from "../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../_components/Table";

export const metadata: Metadata = { title: "Vendors" };

export default async function AdminVendorsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const raw = await searchParams;
  const q = firstParam(raw.q);
  const status = firstParam(raw.status);
  const vendors = await listVendors({ q, status, page: pageParam(raw.page) });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader title="Vendors" description="Pending stores are waiting for approval; open one to review it." />

      <form method="get" action="/admin/vendors" className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-3">
        <Field label="Store name" htmlFor="q">
          <Input id="q" name="q" defaultValue={q} />
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit">Filter</Button>
          <Link href="/admin/vendors" className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
            Reset
          </Link>
        </div>
      </form>

      {vendors.rows.length === 0 ? (
        <EmptyState title="No vendors match" />
      ) : (
        <Table
          head={
            <>
              <Th>Store</Th>
              <Th>Status</Th>
              <Th>KYC</Th>
              <Th>Owner</Th>
              <Th className="text-right">Commission</Th>
              <Th>Submitted</Th>
            </>
          }
        >
          {vendors.rows.map((vendor) => (
            <Tr key={vendor.id}>
              <Td>
                <Link href={`/admin/vendors/${vendor.id}`} className="font-medium text-brand-600 hover:underline">
                  {vendor.name}
                </Link>
                <p className="text-xs text-ink-muted">{humanize(vendor.category)}</p>
              </Td>
              <Td>
                <span className="flex flex-wrap gap-1">
                  <StatusPill status={vendor.status} />
                  {vendor.status === "active" && !vendor.isAcceptingOrders && <Badge>Closed</Badge>}
                </span>
              </Td>
              <Td>
                <StatusPill status={vendor.kycStatus} />
              </Td>
              <Td>{vendor.ownerName ?? "—"}</Td>
              <Td className="text-right">{formatPercent(vendor.commissionBps)}</Td>
              <Td>{formatDateTime(vendor.createdAt)}</Td>
            </Tr>
          ))}
        </Table>
      )}

      <Pagination
        basePath="/admin/vendors"
        params={{ q, status }}
        page={vendors.page}
        pageSize={vendors.pageSize}
        total={vendors.total}
      />
    </div>
  );
}
