import { approveVendorAction, rejectVendorAction } from "@/app/actions/admin";
import { setVendorCommissionAction } from "@/app/actions/admin-settings";
import { getVendorDetail, MENU_ITEM_CAP } from "@/lib/admin/vendors";
import { canManageFinance, requireAdminContext } from "@/lib/auth/dal";
import { Badge, EmptyState, Input } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminActionForm } from "../../../_components/AdminActionForm";
import { ConfirmedAction } from "../../../_components/ConfirmedAction";
import { Field } from "../../../_components/Field";
import { formatDateTime, formatPercent, humanize, money } from "../../../_components/format";
import { OrderRows } from "../../../_components/OrderRows";
import { OwnerMoney } from "../../../_components/OwnerMoney";
import { PageHeader } from "../../../_components/PageHeader";
import { RatingsTable } from "../../../_components/RatingsTable";
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

  const { vendor, owner, staff, balance, recentPayouts, recentOrders, menu, recentRatings } = detail;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={vendor.name} description={`${humanize(vendor.category)} store. Review its details, handle approval, and pay what it is owed.`} actions={<StatusPill status={vendor.status} label={vendor.status === "pending" ? "Pending approval" : undefined} />}
      />

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
              { label: "Identity check", value: <StatusPill status={vendor.kyc_status} /> },
              { label: "Accepting orders", value: vendor.is_accepting_orders ? "Yes" : "No" },
              { label: "KiaKia's cut of each order", value: formatPercent(vendor.commission_bps) },
              { label: "Rating", value: vendor.rating_count > 0 ? `${vendor.rating_avg.toFixed(1)} (${vendor.rating_count})` : "No ratings" },
              { label: "Applied", value: formatDateTime(vendor.created_at) },
            ]}
          />
        </Section>

        <Section title="Approval and suspension">
          {vendor.status === "pending" && (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-ink-muted">
                This store applied to sell on KiaKia. Approving it lets the store sell to customers. It does not move any money.
              </p>
              <ConfirmedAction action={approveVendorAction.bind(null, vendor.id)} submitLabel="Approve vendor" reasonLabel="Note" />
              <ConfirmedAction
                action={rejectVendorAction.bind(null, vendor.id)}
                submitLabel="Reject application"
                variant="danger"
                reasonLabel="Reason"
                confirmLabel="I confirm this store should be turned down."
              />
            </div>
          )}
          {vendor.status === "active" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-muted">
                Suspending hides the store from customers. It does not move any money, and you can undo it with Reinstate vendor.
              </p>
              <ConfirmedAction
                action={rejectVendorAction.bind(null, vendor.id)}
                submitLabel="Suspend vendor"
                variant="danger"
                reasonLabel="Reason"
                confirmLabel="I confirm this store should be suspended and hidden from customers."
              />
            </div>
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

      <Section title="KiaKia's cut (commission)">
        <p className="mb-3 text-sm text-ink-muted">
          The percentage KiaKia keeps from each order. It is taken when the money held until delivery is paid out, so a change also affects orders that are already paid but not yet delivered.
        </p>
        {financeAccess ? (
        <AdminActionForm
          action={setVendorCommissionAction}
          submitLabel="Save commission"
          reason={{ required: true }}
          confirmLabel="I confirm this change to the percentage."
        >
          <input type="hidden" name="vendorId" value={vendor.id} />
          <Field label="KiaKia's cut (%)" htmlFor="commission-percent">
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
              { label: "KiaKia's cut", value: formatPercent(vendor.commission_bps) },
            ]}
          />
        )}
        {!financeAccess && <p className="mt-3 text-sm text-ink-muted">Only finance admins and superadmins can change the commission. Ask one of them.</p>}
      </Section>

      <OwnerMoney
        ownerType="vendor"
        ownerId={vendor.id}
        ownerName={vendor.name}
        owedKobo={balance?.balanceKobo ?? 0}
        paidKobo={balance?.disbursedKobo ?? 0}
        bank="Bank details not on file"
        canRecord={financeAccess}
        payouts={recentPayouts}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Staff">
          {staff.length === 0 ? (
            <EmptyState title="No staff added" />
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

      <Section title="Menu">
        {menu.categories.length === 0 ? (
          <EmptyState title="No menu items yet" description="This store has not added anything to sell." />
        ) : (
          <div className="flex flex-col gap-6">
            {menu.categories.map((category) => (
              <div key={category.id ?? category.categoryKey ?? "uncategorised"} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-ink">{category.label}</h3>
                  {!category.isActive && <Badge tone="neutral">Inactive</Badge>}
                </div>
                {category.items.length === 0 ? (
                  <p className="text-sm text-ink-muted">No items</p>
                ) : (
                  <Table
                    head={
                      <>
                        <Th>Item</Th>
                        <Th className="text-right">Price</Th>
                        <Th>Availability</Th>
                      </>
                    }
                  >
                    {category.items.map((item) => (
                      <Tr key={item.id}>
                        <Td>{item.name}</Td>
                        <Td className="text-right">{money(item.priceKobo)}</Td>
                        <Td>
                          <Badge tone={item.isAvailable ? "positive" : "neutral"}>
                            {item.isAvailable ? "Available" : "Unavailable"}
                          </Badge>
                        </Td>
                      </Tr>
                    ))}
                  </Table>
                )}
              </div>
            ))}
          </div>
        )}
        {menu.truncated && (
          <p className="mt-3 text-sm text-ink-muted">Showing the first {MENU_ITEM_CAP} menu items; the full menu is larger.</p>
        )}
      </Section>

      <Section title="Recent ratings">
        {recentRatings.length === 0 ? <EmptyState title="No ratings yet" /> : <RatingsTable ratings={recentRatings} showCustomer />}
      </Section>

      <Section
        title="Recent orders"
        aside={
          <Link href={`/admin/orders?vendor=${vendor.id}`} className="text-sm text-brand-600 hover:underline">
            All orders
          </Link>
        }
      >
        {recentOrders.length === 0 ? <EmptyState title="No orders yet" description="Orders placed with this store will be listed here." /> : <OrderRows orders={recentOrders} />}
      </Section>
    </div>
  );
}
