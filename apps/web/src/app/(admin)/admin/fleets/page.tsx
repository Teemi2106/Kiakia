import { createFleetAction } from "@/app/actions/admin-fleets";
import { listFleets } from "@/lib/admin/fleets";
import { requireAdminContext } from "@/lib/auth/dal";
import { EmptyState, Input } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminActionForm } from "../../_components/AdminActionForm";
import { Field } from "../../_components/Field";
import { formatDateTime } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Section } from "../../_components/Section";
import { StatusPill } from "../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../_components/Table";

export const metadata: Metadata = { title: "Fleets" };

export default async function AdminFleetsPage() {
  await requireAdminContext();
  const fleets = await listFleets();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title="Fleets"
        description="Rider management companies. Each fleet gets its own console where its managers see only their riders: who is online, where they are heading, and where orders are most in demand."
      />

      {fleets.length === 0 ? (
        <EmptyState title="No fleets yet" description="Create a fleet below, then add its manager and attach its riders." />
      ) : (
        <Table
          head={
            <>
              <Th>Fleet</Th>
              <Th>Status</Th>
              <Th>Managers</Th>
              <Th>Riders</Th>
              <Th>Online now</Th>
              <Th>Created</Th>
            </>
          }
        >
          {fleets.map((fleet) => (
            <Tr key={fleet.id}>
              <Td>
                <Link href={`/admin/fleets/${fleet.id}`} className="font-medium text-brand-600 hover:underline">
                  {fleet.name}
                </Link>
              </Td>
              <Td>
                <StatusPill status={fleet.status} />
              </Td>
              <Td>{fleet.managerCount}</Td>
              <Td>{fleet.riderCount}</Td>
              <Td>{fleet.onlineCount}</Td>
              <Td className="text-ink-muted">{formatDateTime(fleet.createdAt)}</Td>
            </Tr>
          ))}
        </Table>
      )}

      <Section title="Create a fleet">
        <AdminActionForm action={createFleetAction} submitLabel="Create fleet">
          <Field label="Fleet name" htmlFor="fleet-name">
            <Input id="fleet-name" name="name" required minLength={2} maxLength={80} className="w-full" />
          </Field>
        </AdminActionForm>
      </Section>
    </div>
  );
}
