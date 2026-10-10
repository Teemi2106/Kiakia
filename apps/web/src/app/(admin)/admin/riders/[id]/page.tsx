import { approveRiderAction, rejectRiderAction } from "@/app/actions/admin";
import { getRiderDetail } from "@/lib/admin/riders";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmedAction } from "../../../_components/ConfirmedAction";
import { formatDateTime, humanize, money } from "../../../_components/format";
import { MaskedAccountNumber } from "../../../_components/MaskedAccountNumber";
import { OrderRows } from "../../../_components/OrderRows";
import { PageHeader } from "../../../_components/PageHeader";
import { Fields, Section } from "../../../_components/Section";
import { StatusPill } from "../../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../../_components/Table";
import { RiderDocuments } from "./_components/RiderDocuments";

export const metadata: Metadata = { title: "Rider" };

export default async function AdminRiderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminContext();

  const { id } = await params;
  const detail = await getRiderDetail(id);
  if (!detail) notFound();

  const { rider, bank, profile, documents, balance, recentPayouts, recentDeliveries } = detail;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={profile?.fullName ?? "Rider"}
        description={profile?.phone ?? undefined}
        actions={<StatusPill status={rider.kyc_status} />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Rider">
          <Fields
            items={[
              {
                label: "Account",
                value: (
                  <Link href={`/admin/users/${rider.user_id}`} className="text-brand-600 hover:underline">
                    View user
                  </Link>
                ),
              },
              { label: "Vehicle", value: rider.vehicle_type ? humanize(rider.vehicle_type) : null },
              { label: "Plate number", value: rider.plate_number },
              {
                label: "Availability",
                value: <Badge tone={rider.is_online ? "positive" : "neutral"}>{rider.is_online ? "Online" : "Offline"}</Badge>,
              },
              { label: "Last seen", value: rider.last_ping_at ? formatDateTime(rider.last_ping_at) : null },
              { label: "Joined", value: formatDateTime(rider.created_at) },
            ]}
          />
        </Section>

        <Section title="Bank details">
          {bank ? (
            <Fields
              items={[
                { label: "Bank", value: bank.bankName },
                { label: "Account name", value: bank.accountName },
                {
                  label: "Account number",
                  value: (
                    <MaskedAccountNumber masked={bank.maskedNumber} fullNumber={bank.fullNumber} />
                  ),
                },
              ]}
            />
          ) : (
            <EmptyState title="No bank details" description="The rider has not added a payout account." />
          )}
        </Section>
      </div>

      <Section title="KYC documents">
        <RiderDocuments documents={documents} />
      </Section>

      <Section title="KYC decision">
        <p className="mb-3 text-sm text-ink-muted">
          Approving the rider is separate from approving each document; check every document first.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {rider.kyc_status !== "approved" && (
            <ConfirmedAction
              action={approveRiderAction.bind(null, rider.user_id)}
              submitLabel="Approve rider"
              reasonLabel="Note"
              confirmLabel="I have reviewed every document."
            />
          )}
          {rider.kyc_status !== "rejected" && (
            <ConfirmedAction
              action={rejectRiderAction.bind(null, rider.user_id)}
              submitLabel="Reject rider"
              variant="danger"
              reasonLabel="Reason"
              confirmLabel="I confirm this rider should be rejected."
            />
          )}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Balance">
          <Fields
            items={[
              { label: "Available", value: money(balance?.balanceKobo ?? 0) },
              { label: "Paid out", value: money(balance?.disbursedKobo ?? 0) },
            ]}
          />
        </Section>

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
      </div>

      <Section title="Recent deliveries">
        {recentDeliveries.length === 0 ? <EmptyState title="No deliveries yet" /> : <OrderRows orders={recentDeliveries} />}
      </Section>
    </div>
  );
}
