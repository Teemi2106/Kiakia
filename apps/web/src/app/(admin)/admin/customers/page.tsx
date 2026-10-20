import { listCustomers } from "@/lib/admin/users";
import { requireAdminContext } from "@/lib/auth/dal";
import { Button, EmptyState, Input, Select, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Field } from "../../_components/Field";
import { formatDateTime, money } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";
import { StatusPill } from "../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../_components/Table";

export const metadata: Metadata = { title: "Customers" };

export default async function AdminCustomersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const raw = await searchParams;
  const q = firstParam(raw.q);
  const status = firstParam(raw.status);
  const customers = await listCustomers({ q, status, page: pageParam(raw.page) });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader
        title="Customers"
        description="People who order on KiaKia. Anyone who is also a vendor or rider is not listed here: find them on the Vendors or Riders page."
      />

      <form method="get" action="/admin/customers" className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-3">
        <Field label="Search by name or phone" htmlFor="q">
          <Input id="q" name="q" defaultValue={q} />
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deleted">Deleted</option>
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit">Search</Button>
          {(q || status) && (
            <Link href="/admin/customers" className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
              Clear
            </Link>
          )}
        </div>
      </form>

      {customers.rows.length === 0 ? (
        <EmptyState
          title="No customers found"
          description={q || status ? "Try a different name or phone number, or clear the filters." : "Customers appear here once they sign up."}
        />
      ) : (
        <Table
          head={
            <>
              <Th>Customer</Th>
              <Th>Status</Th>
              <Th className="text-right">Orders</Th>
              <Th className="text-right">Wallet balance</Th>
              <Th>Joined</Th>
              <Th>
                <span className="sr-only">Action</span>
              </Th>
            </>
          }
        >
          {customers.rows.map((customer) => (
            <Tr key={customer.id}>
              <Td>
                <Link href={`/admin/customers/${customer.id}`} className="font-medium text-brand-600 hover:underline">
                  {customer.fullName ?? "Unnamed customer"}
                </Link>
                <p className="text-xs text-ink-muted">{customer.phone ?? "No phone"}</p>
              </Td>
              <Td>
                <StatusPill status={customer.status} />
              </Td>
              <Td className="text-right">{customer.orderCount}</Td>
              <Td className="text-right">{money(customer.walletBalanceKobo)}</Td>
              <Td>{formatDateTime(customer.createdAt)}</Td>
              <Td>
                <Link href={`/admin/customers/${customer.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Open
                </Link>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      <Pagination basePath="/admin/customers" params={{ q, status }} page={customers.page} pageSize={customers.pageSize} total={customers.total} />
    </div>
  );
}
