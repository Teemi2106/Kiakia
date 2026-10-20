import { listUsers } from "@/lib/admin/users";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Button, EmptyState, Input, Select } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Field } from "../../_components/Field";
import { formatDateTime } from "../../_components/format";
import { roleLabel } from "../../_components/labels";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";
import { StatusPill } from "../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../_components/Table";

export const metadata: Metadata = { title: "Admins & access" };

const ROLE_FILTERS = ["admin", "superadmin", "rider", "vendor_owner", "vendor_manager", "vendor_staff"] as const;

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const raw = await searchParams;
  const q = firstParam(raw.q);
  const status = firstParam(raw.status);
  const role = firstParam(raw.role);
  const users = await listUsers({ q, status, role, page: pageParam(raw.page) });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader
        title="Admins & access"
        description="Find any account to give or take away admin access, or to suspend it. To make someone an admin, search for them, open their account and use Admin access. Day-to-day customer, vendor and rider work is on their own pages."
      />

      <form method="get" action="/admin/users" className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <Field label="Has this role" htmlFor="role">
          <Select id="role" name="role" defaultValue={role ?? ""}>
            <option value="">All</option>
            {ROLE_FILTERS.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit">Search</Button>
          <Link href="/admin/users" className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
            Clear
          </Link>
        </div>
      </form>

      {users.rows.length === 0 ? (
        <EmptyState title="No accounts found" description="Try a different name or phone number, or clear the filters." />
      ) : (
        <Table
          head={
            <>
              <Th>Person</Th>
              <Th>Status</Th>
              <Th>Roles</Th>
              <Th>Joined</Th>
            </>
          }
        >
          {users.rows.map((user) => (
            <Tr key={user.id}>
              <Td>
                <Link href={`/admin/users/${user.id}`} className="font-medium text-brand-600 hover:underline">
                  {user.fullName ?? "Unnamed account"}
                </Link>
                <p className="text-xs text-ink-muted">{user.phone ?? "No phone"}</p>
              </Td>
              <Td>
                <StatusPill status={user.status} />
              </Td>
              <Td>
                <span className="flex flex-wrap gap-1">
                  {user.roles.map((userRole) => (
                    <Badge key={userRole}>{roleLabel(userRole)}</Badge>
                  ))}
                </span>
              </Td>
              <Td>{formatDateTime(user.createdAt)}</Td>
            </Tr>
          ))}
        </Table>
      )}

      <Pagination
        basePath="/admin/users"
        params={{ q, status, role }}
        page={users.page}
        pageSize={users.pageSize}
        total={users.total}
      />
    </div>
  );
}
