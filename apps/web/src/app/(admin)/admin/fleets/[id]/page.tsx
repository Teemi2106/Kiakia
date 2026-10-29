import { addFleetManagerAction, removeFleetManagerAction, setFleetStatusAction } from "@/app/actions/admin-fleets";
import { getFleetDetail } from "@/lib/admin/fleets";
import { isSuperadmin, requireAdminContext } from "@/lib/auth/dal";
import { Badge } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountPicker } from "../../../_components/AccountPicker";
import { AdminActionForm } from "../../../_components/AdminActionForm";
import { Field } from "../../../_components/Field";
import { formatDateTime } from "../../../_components/format";
import { PageHeader } from "../../../_components/PageHeader";
import { Fields, Section } from "../../../_components/Section";
import { StatusPill } from "../../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../../_components/Table";

export const metadata: Metadata = { title: "Fleet" };

export default async function AdminFleetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminContext();
  const { id } = await params;
  const [fleet, canManageManagers] = await Promise.all([getFleetDetail(id), isSuperadmin()]);
  if (!fleet) notFound();

  const nextStatus = fleet.status === "active" ? "suspended" : "active";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={fleet.name}
        description="Managers see this fleet's riders in their own console. Add riders to the fleet from each rider's page."
        actions={<StatusPill status={fleet.status} />}
      />

      <Section title="Details">
        <Fields
          items={[
            { label: "Managers", value: fleet.managers.length },
            { label: "Riders", value: fleet.riders.length },
            { label: "Created", value: formatDateTime(fleet.createdAt) },
          ]}
        />
      </Section>

      <Section title="Managers">
        {fleet.managers.length === 0 ? (
          <p className="text-sm text-ink-muted">Nobody manages this fleet yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {fleet.managers.map((manager) => (
              <li key={manager.userId} className="flex flex-wrap items-start justify-between gap-4 py-3">
                <div>
                  <p className="font-medium text-ink">{manager.fullName ?? "Unnamed"}</p>
                  <p className="text-xs text-ink-muted">{manager.phone ?? "No phone"}</p>
                </div>
                {canManageManagers && (
                  <div className="w-full max-w-xs">
                    <AdminActionForm action={removeFleetManagerAction} submitLabel="Remove" variant="danger">
                      <input type="hidden" name="fleetId" value={fleet.id} />
                      <input type="hidden" name="userId" value={manager.userId} />
                    </AdminActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManageManagers ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-3 text-sm text-ink-muted">
              Add someone who already has a KiaKia account. They sign in as normal and open <span className="font-medium text-ink">/fleet</span>. A person can manage one fleet.
            </p>
            <AdminActionForm action={addFleetManagerAction} submitLabel="Add manager">
              <input type="hidden" name="fleetId" value={fleet.id} />
              <Field label="Who is the manager?" htmlFor="manager-search">
                <AccountPicker id="manager-search" name="userId" />
              </Field>
            </AdminActionForm>
          </div>
        ) : (
          <p className="mt-4 border-t border-border pt-4 text-sm text-ink-muted">Only a superadmin can add or remove fleet managers.</p>
        )}
      </Section>

      <Section title={`Riders (${fleet.riders.length})`}>
        {fleet.riders.length === 0 ? (
          <p className="text-sm text-ink-muted">No riders yet. Open a rider in Riders and choose this fleet.</p>
        ) : (
          <Table
            head={
              <>
                <Th>Rider</Th>
                <Th>Availability</Th>
              </>
            }
          >
            {fleet.riders.map((rider) => (
              <Tr key={rider.userId}>
                <Td>
                  <Link href={`/admin/riders/${rider.userId}`} className="font-medium text-brand-600 hover:underline">
                    {rider.fullName ?? "Unnamed rider"}
                  </Link>
                  <p className="text-xs text-ink-muted">{rider.phone ?? "No phone"}</p>
                </Td>
                <Td>
                  <Badge tone={rider.isOnline ? "positive" : "neutral"}>{rider.isOnline ? "Online" : "Offline"}</Badge>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={fleet.status === "active" ? "Suspend this fleet" : "Reactivate this fleet"}>
        <p className="mb-3 text-sm text-ink-muted">
          {fleet.status === "active"
            ? "Managers lose access to their console straight away. Riders keep working and keep getting offers."
            : "Managers get their console back."}
        </p>
        <AdminActionForm
          action={setFleetStatusAction}
          submitLabel={fleet.status === "active" ? "Suspend fleet" : "Reactivate fleet"}
          variant={fleet.status === "active" ? "danger" : undefined}
        >
          <input type="hidden" name="fleetId" value={fleet.id} />
          <input type="hidden" name="status" value={nextStatus} />
        </AdminActionForm>
      </Section>
    </div>
  );
}
