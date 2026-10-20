import { listOrders } from "@/lib/admin/orders";
import { optionalUuid } from "@/lib/admin/query";
import { listVendors } from "@/lib/admin/vendors";
import { requireAdminContext } from "@/lib/auth/dal";
import { ORDER_STATUSES } from "@kiakia/domain";
import { Button, EmptyState, Input, OrderStatusBadge, Select } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { ExportForm, defaultExportRange } from "../../_components/ExportForm";
import { Field } from "../../_components/Field";
import { formatDateTime, humanize, money } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";
import { StatusPill } from "../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../_components/Table";

export const metadata: Metadata = { title: "Orders" };

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const raw = await searchParams;
  const filters = {
    q: firstParam(raw.q),
    status: firstParam(raw.status),
    vendorId: firstParam(raw.vendor),
    from: firstParam(raw.from),
    to: firstParam(raw.to),
  };

  const [orders, vendors] = await Promise.all([
    listOrders({ ...filters, page: pageParam(raw.page) }),
    listVendors({ pageSize: 100 }),
  ]);
  const vendorKnown = !filters.vendorId || vendors.rows.some((vendor) => vendor.id === filters.vendorId);

  // The export refuses a filter it can't parse, so only carry over valid ones.
  const exportRange = defaultExportRange(filters.from, filters.to);
  const exportStatus = ORDER_STATUSES.find((status) => status === filters.status);
  const exportVendorId = optionalUuid.parse(filters.vendorId);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader title="Orders" description="Every order on KiaKia, newest first. Open an order to see who is involved, what was paid and what happened, or to refund it." />

      <form method="get" action="/admin/orders" className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Find by order code" htmlFor="q">
          <Input id="q" name="q" defaultValue={filters.q} placeholder="e.g. KK-1042" />
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">All</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Store" htmlFor="vendor">
          <Select id="vendor" name="vendor" defaultValue={filters.vendorId ?? ""}>
            <option value="">All</option>
            {!vendorKnown && <option value={filters.vendorId}>{filters.vendorId}</option>}
            {vendors.rows.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="from">
          <Input id="from" name="from" type="date" defaultValue={filters.from} />
        </Field>
        <Field label="To" htmlFor="to">
          <Input id="to" name="to" type="date" defaultValue={filters.to} />
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit">Search</Button>
          <Link href="/admin/orders" className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
            Clear
          </Link>
        </div>
      </form>

      <ExportForm
        action="/admin/orders/export"
        title="Download orders"
        description="A CSV file of orders placed in a date range of up to 92 days. The order code search is not applied."
        idPrefix="orders-export"
        defaultFrom={exportRange.from}
        defaultTo={exportRange.to}
        hidden={{ status: exportStatus, vendorId: exportVendorId }}
      />

      {orders.rows.length === 0 ? (
        <EmptyState title="No orders match" description="Try widening the filters." />
      ) : (
        <Table
          head={
            <>
              <Th>Order</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th>Store</Th>
              <Th>Customer</Th>
              <Th className="text-right">Total</Th>
              <Th>Placed</Th>
            </>
          }
        >
          {orders.rows.map((order) => (
            <Tr key={order.id}>
              <Td>
                <Link href={`/admin/orders/${order.id}`} className="font-medium text-brand-600 hover:underline">
                  {order.code}
                </Link>
              </Td>
              <Td>
                <OrderStatusBadge status={order.status} />
              </Td>
              <Td>
                <StatusPill status={order.paymentStatus} label={order.paymentStatus === "pending" ? "Awaiting payment" : undefined} />
              </Td>
              <Td>{order.vendorName ?? "—"}</Td>
              <Td>{order.customerName ?? "—"}</Td>
              <Td className="text-right">{money(order.totalKobo)}</Td>
              <Td>{formatDateTime(order.createdAt)}</Td>
            </Tr>
          ))}
        </Table>
      )}

      <Pagination
        basePath="/admin/orders"
        params={{ q: filters.q, status: filters.status, vendor: filters.vendorId, from: filters.from, to: filters.to }}
        page={orders.page}
        pageSize={orders.pageSize}
        total={orders.total}
        hasNext={orders.hasNext}
        approximateTotal={orders.approximateTotal}
      />
    </div>
  );
}
