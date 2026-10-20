import { countVendorsByStatus, listVendors } from "@/lib/admin/vendors";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Button, EmptyState, Input, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Field } from "../../_components/Field";
import { formatDateTime, formatPercent, humanize } from "../../_components/format";
import { LinkTabs } from "../../_components/LinkTabs";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";
import { StatusPill } from "../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../_components/Table";

export const metadata: Metadata = { title: "Vendors" };

const STATUSES = ["pending", "active", "suspended"] as const;
type Status = (typeof STATUSES)[number];

const EMPTY: Record<Status | "all", { title: string; description: string }> = {
  all: { title: "No vendors found", description: "Try a different name, or clear the search." },
  pending: { title: "No vendors waiting for approval", description: "New stores that apply to sell on KiaKia will show up here." },
  active: { title: "No active vendors", description: "Approved stores that can take orders will show up here." },
  suspended: { title: "No suspended vendors", description: "Stores you suspend are listed here, and can be reinstated." },
};

export default async function AdminVendorsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const raw = await searchParams;
  const q = firstParam(raw.q);
  const status = STATUSES.find((value) => value === firstParam(raw.status));
  const [vendors, counts] = await Promise.all([listVendors({ q, status, page: pageParam(raw.page) }), countVendorsByStatus()]);

  const tabHref = (value?: Status) => {
    const query = new URLSearchParams();
    if (value) query.set("status", value);
    if (q) query.set("q", q);
    const string = query.toString();
    return string ? `/admin/vendors?${string}` : "/admin/vendors";
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader
        title="Vendors"
        description="The stores that sell on KiaKia. Approve new stores here, and suspend a store to hide it from customers."
      />

      <LinkTabs
        label="Vendor status"
        value={status ?? "all"}
        items={[
          { value: "pending", label: "Pending approval", href: tabHref("pending"), count: counts.pending },
          { value: "active", label: "Active", href: tabHref("active"), count: counts.active },
          { value: "suspended", label: "Suspended", href: tabHref("suspended"), count: counts.suspended },
          { value: "all", label: "All", href: tabHref(), count: counts.pending + counts.active + counts.suspended },
        ]}
      />

      <form method="get" action="/admin/vendors" className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface-raised p-4">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="w-full max-w-sm">
          <Field label="Search by store name, or the owner's name or phone" htmlFor="q">
            <Input id="q" name="q" defaultValue={q} />
          </Field>
        </div>
        <Button type="submit">Search</Button>
        {q && (
          <Link href={tabHref()} className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
            Clear search
          </Link>
        )}
      </form>

      {vendors.rows.length === 0 ? (
        <EmptyState {...(q ? EMPTY.all : EMPTY[status ?? "all"])} />
      ) : (
        <Table
          head={
            <>
              <Th>Store</Th>
              <Th>Status</Th>
              <Th>Owner</Th>
              <Th className="text-right">KiaKia&apos;s cut</Th>
              <Th>Applied</Th>
              <Th>
                <span className="sr-only">Action</span>
              </Th>
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
                  <StatusPill status={vendor.status} label={vendor.status === "pending" ? "Pending approval" : undefined} />
                  {vendor.status === "active" && !vendor.isAcceptingOrders && <Badge>Closed right now</Badge>}
                </span>
              </Td>
              <Td>{vendor.ownerName ?? "—"}</Td>
              <Td className="text-right">{formatPercent(vendor.commissionBps)}</Td>
              <Td>{formatDateTime(vendor.createdAt)}</Td>
              <Td>
                <Link
                  href={`/admin/vendors/${vendor.id}`}
                  className={buttonVariants({ variant: vendor.status === "pending" ? "primary" : "secondary", size: "sm" })}
                >
                  {vendor.status === "pending" ? "Review" : "Open"}
                </Link>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      <Pagination basePath="/admin/vendors" params={{ q, status }} page={vendors.page} pageSize={vendors.pageSize} total={vendors.total} />
    </div>
  );
}
