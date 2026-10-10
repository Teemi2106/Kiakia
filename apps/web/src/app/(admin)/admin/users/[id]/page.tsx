import { setPlatformRoleAction, setUserStatusAction } from "@/app/actions/admin-users";
import { getUserDetail } from "@/lib/admin/users";
import { isSuperadmin, requireAdminContext } from "@/lib/auth/dal";
import { Badge, EmptyState, Select } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminActionForm } from "../../../_components/AdminActionForm";
import { Field } from "../../../_components/Field";
import { formatDateTime, humanize, money } from "../../../_components/format";
import { OrderRows } from "../../../_components/OrderRows";
import { PageHeader } from "../../../_components/PageHeader";
import { Fields, Section } from "../../../_components/Section";
import { StatusPill } from "../../../_components/StatusPill";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminContext();

  const { id } = await params;
  const [detail, canManageAdmins] = await Promise.all([getUserDetail(id), isSuperadmin()]);
  if (!detail) notFound();

  const { profile, email, roles, wallet, recentOrders, signInBanned } = detail;
  const suspended = profile.status === "suspended";

  // Display-only: admin_set_platform_role enforces who may grant admin/superadmin.
  const grantableRoles = canManageAdmins ? (["rider", "admin", "superadmin"] as const) : (["rider"] as const);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={profile.full_name ?? "Unnamed user"}
        description={email ?? profile.phone ?? undefined}
        actions={<StatusPill status={profile.status} />}
      />

      {suspended && (
        <p
          role="status"
          className={`rounded-control px-3 py-2 text-sm ${signInBanned ? "bg-danger-surface text-danger" : "bg-[#FFDCC5] text-kk-orange-deep"}`}
        >
          {signInBanned
            ? "Sign-in blocked."
            : "Sign-in ban pending — rider is finishing a delivery; submit the suspension again once it completes."}
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

        <Section title="Roles">
          {roles.length === 0 ? (
            <EmptyState title="No roles" />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {roles.map((role) => (
                <li key={`${role.role}:${role.scopeId ?? "platform"}`}>
                  <Badge>
                    {humanize(role.role)}
                    {role.scopeType === "vendor" && role.scopeId ? " (store)" : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {profile.status !== "deleted" && (
        <Section title={suspended ? "Reinstate account" : "Suspend account"}>
          {suspended ? (
            <div className="flex flex-col gap-6">
              {!signInBanned && (
                <div>
                  <p className="mb-3 text-sm text-ink-muted">
                    Applies the sign-in ban once the rider has finished their delivery.
                  </p>
                  <AdminActionForm
                    action={setUserStatusAction}
                    submitLabel="Submit suspension again"
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
                confirmLabel="I confirm this account should be able to sign in again."
              >
                <input type="hidden" name="userId" value={profile.id} />
                <input type="hidden" name="status" value="active" />
              </AdminActionForm>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-muted">
                Blocks sign-in and token refresh. A session that is already signed in can stay valid for up to an hour.
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

      <Section title="Platform roles">
        <p className="mb-3 text-sm text-ink-muted">
          {canManageAdmins
            ? "Grant or revoke the rider, admin and superadmin roles."
            : "Grant or revoke the rider role. Admin and superadmin roles can only be changed by a superadmin."}
        </p>
        <AdminActionForm
          action={setPlatformRoleAction}
          submitLabel="Apply role change"
          variant="danger"
          reason={{ required: true }}
          confirmLabel="I confirm this role change."
        >
          <input type="hidden" name="userId" value={profile.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role" htmlFor="platform-role">
              <Select id="platform-role" name="role" defaultValue="rider">
                {grantableRoles.map((role) => (
                  <option key={role} value={role}>
                    {humanize(role)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Change" htmlFor="platform-role-action">
              <Select id="platform-role-action" name="action" defaultValue="grant">
                <option value="grant">Grant</option>
                <option value="revoke">Revoke</option>
              </Select>
            </Field>
          </div>
        </AdminActionForm>
      </Section>

      <Section
        title="Recent orders"
        aside={
          <Link href="/admin/orders" className="text-sm text-brand-600 hover:underline">
            All orders
          </Link>
        }
      >
        {recentOrders.length === 0 ? <EmptyState title="No orders yet" /> : <OrderRows orders={recentOrders} />}
      </Section>
    </div>
  );
}
