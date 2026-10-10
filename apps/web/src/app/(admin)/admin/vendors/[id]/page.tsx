import { approveVendorAction, rejectVendorAction } from "@/app/actions/admin";
import { setVendorCommissionAction } from "@/app/actions/admin-settings";
import { getVendorDetail } from "@/lib/admin/vendors";
import { canManageFinance, requireAdminContext } from "@/lib/auth/dal";
import { EmptyState, Input } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminActionForm } from "../../../_components/AdminActionForm";
import { ConfirmedAction } from "../../../_components/ConfirmedAction";
import { Field } from "../../../_components/Field";
import { formatDateTime, formatPercent, humanize, money } from "../../../_components/format";
import { OrderRows } from "../../../_components/OrderRows";
import { PageHeader } from "../../../_components/PageHeader";
import { Fields, Section } from "../../../_components/Section";
import { StatusPill } from "../../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../../_components/Table";

export const metadata: Metadata = { title: "Vendor" };

export default async function AdminVendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminContext();
  const financeAccess = await canManageFinance();

  const { id } = await params;
  const detail = await getVendorDetail(id);
  if (!detail) notFound();

  const { vendor, owner, staff, balance, recentPayouts, recentOrders } = detail;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={vendor.name} description={humanize(vendor.category)} actions={<StatusPill status={vendor.status} />} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Store">
          <Fields
            items={[
              { label: "Address", value: vendor.address_line },
              { label: "Landmark", value: vendor.landmark },
              { label: "State", value: vendor.state },
              {
                label: "Owner",
                value: owner ? (
                  <Link href={`/admin/users/${owner.id}`} className="text-brand-600 hover:underline">
                    {owner.fullName ?? owner.id}
                  </Link>
                ) : null,
              },
              { label: "KYC", value: <StatusPill status={vendor.kyc_status} /> },
              { label: "Accepting orders", value: vendor.is_accepting_orders ? "Yes" : "No" },
              { label: "Commission", value: formatPercent(vendor.commission_bps) },
              { label: "Rating", value: vendor.rating_count > 0 ? `${vendor.rating_avg.toFixed(1)} (${vendor.rating_count})` : "No ratings" },
              { label: "Created", value: formatDateTime(vendor.created_at) },
            ]}
          />
        </Section>

        <Section title="Account status">
          {vendor.status === "pending" && (
            <div className="flex flex-col gap-6">
              <ConfirmedAction action={approveVendorAction.bind(null, vendor.id)} submitLabel="Approve vendor" reasonLabel="Note" />
              <ConfirmedAction
                action={rejectVendorAction.bind(null, vendor.id)}
                submitLabel="Reject vendor"
                variant="danger"
                reasonLabel="Reason"
                confirmLabel="I confirm this store should be rejected."
              />
            </div>
          )}
          {vendor.status === "active" && (
            <ConfirmedAction
              action={rejectVendorAction.bind(null, vendor.id)}
              submitLabel="Suspend vendor"
              variant="danger"
              reasonLabel="Reason"
              confirmLabel="I confirm this store should be suspended and hidden from customers."
            />
          )}
          {vendor.status === "suspended" && (
            <ConfirmedAction
              action={approveVendorAction.bind(null, vendor.id)}
              submitLabel="Reinstate vendor"
              reasonLabel="Reason"
              confirmLabel="I confirm this store should be reinstated."
            />
          )}
        </Section>
      </div>

      <Section title="Commission">
        <p className="mb-3 text-sm text-ink-muted">
          Applied when escrow is released, so a change also affects orders that are already paid but not yet delivered.
        </p>
        {financeAccess ? (
        <AdminActionForm
          action={setVendorCommissionAction}
          submitLabel="Update commission"
          reason={{ required: true }}
          confirmLabel="I confirm this commission change."
        >
          <input type="hidden" name="vendorId" value={vendor.id} />
          <Field label="Commission (%)" htmlFor="commission-percent">
            <Input
              id="commission-percent"
              name="commissionPercent"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              required
              defaultValue={vendor.commission_bps / 100}
              className="max-w-40"
            />
          </Field>
        </AdminActionForm>
        ) : (
          <Fields
            items={[
              { label: "Commission", value: formatPercent(vendor.commission_bps) },
            ]}
          />
        )}
        {!financeAccess && <p className="mt-3 text-sm text-ink-muted">Changing the commission needs finance access.</p>}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Balance"
          aside={
            financeAccess ? (
              <Link href="/admin/finance" className="text-sm text-brand-600 hover:underline">
                Record payout
              </Link>
            ) : undefined
          }
        >
          <Fields
            items={[
              { label: "Available", value: money(balance?.balanceKobo ?? 0) },
              { label: "Paid out", value: money(balance?.disbursedKobo ?? 0) },
            ]}
          />
        </Section>

        <Section title="Staff">
          {staff.length === 0 ? (
            <EmptyState title="No staff" />
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {staff.map((member) => (
                <li key={member.userId} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/admin/users/${member.userId}`} className="text-brand-600 hover:underline">
                    {member.fullName ?? member.userId}
                  </Link>
                  <span className="text-ink-muted">{humanize(member.role.replace("vendor_", ""))}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Recent payouts">
        {recentPayouts.length === 0 ? (
          <EmptyState title="No payouts yet" />
        ) : (
          <Table
            head={
              <>
                <Th>Reference</Th>
                <Th className="text-right">Amount</Th>
                <Th>Date</Th>
              </>
            }
          >
            {recentPayouts.map((payout) => (
              <Tr key={payout.transactionId}>
                <Td className="font-mono text-xs">{payout.reference}</Td>
                <Td className="text-right">{money(payout.amountKobo)}</Td>
                <Td>{formatDateTime(payout.createdAt)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title="Recent orders"
        aside={
          <Link href={`/admin/orders?vendor=${vendor.id}`} className="text-sm text-brand-600 hover:underline">
            All orders
          </Link>
        }
      >
        {recentOrders.length === 0 ? <EmptyState title="No orders yet" /> : <OrderRows orders={recentOrders} />}
      </Section>
    </div>
  );
}
