import { setPlatformRoleAction, setUserStatusAction } from "@/app/actions/admin-users";
import { getUserDetail } from "@/lib/admin/users";
import { isSuperadmin, requireAdminContext } from "@/lib/auth/dal";
import { Badge, EmptyState, Select } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminActionForm } from "../../../_components/AdminActionForm";
import { Field } from "../../../_components/Field";
import { formatDateTime, humanize, money } from "../../../_components/format";
import { roleLabel } from "../../../_components/labels";
import { OrderRows } from "../../../_components/OrderRows";
import { PersonMessages } from "../../../_components/PersonMessages";
import { PageHeader } from "../../../_components/PageHeader";
import { Fields, Section } from "../../../_components/Section";
import { StatusPill } from "../../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../../_components/Table";

export const metadata: Metadata = { title: "Account" };

const WALLET_KINDS: Record<string, string> = {
  payment_capture: "Payment for an order",
  escrow_release: "Order paid out",
  refund: "Refund",
  adjustment: "Adjustment",
  payout: "Payout",
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminContext();

  const { id } = await params;
  const [detail, canManageAdmins] = await Promise.all([getUserDetail(id), isSuperadmin()]);
  if (!detail) notFound();

  const { profile, email, roles, wallet, walletActivity, recentOrders, signInBanned } = detail;
  const suspended = profile.status === "suspended";
  const riderRole = roles.some((role) => role.role === "rider");
  const vendorIds = [...new Set(roles.flatMap((role) => (role.scopeType === "vendor" && role.scopeId ? [role.scopeId] : [])))];

  // Display-only: admin_set_platform_role enforces who may grant admin/superadmin.
  const grantableRoles = canManageAdmins ? (["rider", "admin", "superadmin"] as const) : (["rider"] as const);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={profile.full_name ?? "Unnamed account"}
        description={email ?? profile.phone ?? undefined}
        actions={<StatusPill status={profile.status} />}
      />

      {suspended && (
        <p
          role="status"
          className={`rounded-control px-3 py-2 text-sm ${signInBanned ? "bg-danger-surface text-danger" : "bg-[#FFDCC5] text-kk-orange-deep"}`}
        >
          {signInBanned
            ? "This account is suspended and cannot sign in."
            : "This account is suspended, but the rider is finishing a delivery, so they can still sign in for now. Suspend again once the delivery is done to block sign-in."}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Account">
          <Fields
            items={[
              { label: "Email", value: email },
              { label: "Phone", value: profile.phone },
              { label: "Joined", value: formatDateTime(profile.created_at) },
              { label: "Wallet balance", value: money(wallet?.balanceKobo ?? 0) },
            ]}
          />
        </Section>

        <Section title="What this account is">
          {roles.length === 0 ? (
            <EmptyState title="No roles" />
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <li key={`${role.role}:${role.scopeId ?? "platform"}`}>
                    <Badge>{roleLabel(role.role)}</Badge>
                  </li>
                ))}
              </ul>
              {(riderRole || vendorIds.length > 0) && (
                <p className="text-sm text-ink-muted">
                  This account is also a {riderRole && "rider"}
                  {riderRole && vendorIds.length > 0 && " and a "}
                  {vendorIds.length > 0 && "vendor"}.{" "}
                  {riderRole && (
                    <Link href={`/admin/riders/${profile.id}`} className="text-brand-600 hover:underline">
                      Open rider page
                    </Link>
                  )}
                  {vendorIds.map((vendorId) => (
                    <Link key={vendorId} href={`/admin/vendors/${vendorId}`} className="ml-2 text-brand-600 hover:underline">
                      Open store page
                    </Link>
                  ))}
                </p>
              )}
            </div>
          )}
        </Section>
      </div>

      {profile.status !== "deleted" && (
        <Section title={suspended ? "Reinstate this account" : "Suspend this account"}>
          {suspended ? (
            <div className="flex flex-col gap-6">
              {!signInBanned && (
                <div>
                  <p className="mb-3 text-sm text-ink-muted">
                    Blocks sign-in once the rider has finished their delivery. Does not move any money.
                  </p>
                  <AdminActionForm
                    action={setUserStatusAction}
                    submitLabel="Suspend account again"
                    variant="danger"
                    reason={{ required: true }}
                    confirmLabel="I confirm this account should be suspended."
                  >
                    <input type="hidden" name="userId" value={profile.id} />
                    <input type="hidden" name="status" value="suspended" />
                  </AdminActionForm>
                </div>
              )}
              <AdminActionForm
                action={setUserStatusAction}
                submitLabel="Reinstate account"
                reason={{}}
                confirmLabel="I confirm this person should be able to sign in again."
              >
                <input type="hidden" name="userId" value={profile.id} />
                <input type="hidden" name="status" value="active" />
              </AdminActionForm>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-muted">
                The person will not be able to sign in. Someone who is signed in right now can stay signed in for up to an hour. This does not move any money, and you can undo it with Reinstate account.
              </p>
              <AdminActionForm
                action={setUserStatusAction}
                submitLabel="Suspend account"
                variant="danger"
                reason={{ required: true }}
                confirmLabel="I confirm this account should be suspended."
              >
                <input type="hidden" name="userId" value={profile.id} />
                <input type="hidden" name="status" value="suspended" />
              </AdminActionForm>
            </>
          )}
        </Section>
      )}

      <Section title="Admin access">
        <p className="mb-3 text-sm text-ink-muted">
          {canManageAdmins
            ? "Only needed for staff. Give or take away the Rider, Admin or Superadmin role. Admins can use this admin area; superadmins can also manage other admins."
            : "Only needed for staff. Give or take away the Rider role. Only a superadmin can give or take away Admin and Superadmin access."}
        </p>
        <AdminActionForm
          action={setPlatformRoleAction}
          submitLabel="Change access"
          variant="danger"
          reason={{ required: true }}
          confirmLabel="I confirm this change to the account's access."
        >
          <input type="hidden" name="userId" value={profile.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role" htmlFor="platform-role">
              <Select id="platform-role" name="role" defaultValue="rider">
                {grantableRoles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="What to do" htmlFor="platform-role-action">
              <Select id="platform-role-action" name="action" defaultValue="grant">
                <option value="grant">Give this role</option>
                <option value="revoke">Take this role away</option>
              </Select>
            </Field>
          </div>
        </AdminActionForm>
      </Section>

      <Section title="Wallet history">
        {walletActivity.length === 0 ? (
          <EmptyState title="No wallet history yet" description="Refunds and wallet payments will be listed here." />
        ) : (
          <Table
            head={
              <>
                <Th>Date</Th>
                <Th>Direction</Th>
                <Th className="text-right">Amount</Th>
                <Th>What for</Th>
                <Th>Order</Th>
              </>
            }
          >
            {walletActivity.map((entry) => (
              <Tr key={entry.id}>
                <Td>{formatDateTime(entry.createdAt)}</Td>
                <Td>
                  <Badge tone={entry.direction === "credit" ? "positive" : "neutral"}>{entry.direction === "credit" ? "Money in" : "Money out"}</Badge>
                </Td>
                <Td className="text-right">
                  {entry.direction === "credit" ? "+" : "-"}
                  {money(entry.amountKobo)}
                </Td>
                <Td>{WALLET_KINDS[entry.transactionKind ?? entry.entryType] ?? humanize(entry.transactionKind ?? entry.entryType)}</Td>
                <Td>
                  {entry.orderId ? (
                    <Link href={`/admin/orders/${entry.orderId}`} className="font-medium text-brand-600 hover:underline">
                      {entry.orderCode ?? "View order"}
                    </Link>
                  ) : (
                    "-"
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title="Recent orders"
        aside={
          <Link href="/admin/orders" className="text-sm text-brand-600 hover:underline">
            All orders
          </Link>
        }
      >
        {recentOrders.length === 0 ? <EmptyState title="No orders yet" description="Orders this account places will be listed here." /> : <OrderRows orders={recentOrders} />}
      </Section>

      {profile.status !== "deleted" && (
        <Suspense fallback={<div className="h-48 animate-pulse rounded-card bg-border/60" aria-hidden="true" />}>
          <PersonMessages userId={profile.id} personName={profile.full_name} />
        </Suspense>
      )}
    </div>
  );
}
