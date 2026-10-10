import { listOrders } from "@/lib/admin/orders";
import { listVendors } from "@/lib/admin/vendors";
import { requireAdminContext } from "@/lib/auth/dal";
import { ORDER_STATUSES } from "@kiakia/domain";
import { Button, EmptyState, Input, OrderStatusBadge, Select } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader title="Orders" description="Every order on the platform, newest first." />

      <form method="get" action="/admin/orders" className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Order code" htmlFor="q">
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
        <Field label="Vendor" htmlFor="vendor">
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
          <Button type="submit">Filter</Button>
          <Link href="/admin/orders" className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
            Reset
          </Link>
        </div>
      </form>

      {orders.rows.length === 0 ? (
        <EmptyState title="No orders match" description="Try widening the filters." />
      ) : (
        <Table
          head={
            <>
              <Th>Order</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th>Vendor</Th>
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
                <StatusPill status={order.paymentStatus} />
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
      />
    </div>
  );
}
