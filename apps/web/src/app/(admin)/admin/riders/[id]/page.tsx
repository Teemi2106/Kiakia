import { approveRiderAction, rejectRiderAction } from "@/app/actions/admin";
import { getRiderDetail } from "@/lib/admin/riders";
import { canManageFinance, requireAdminContext } from "@/lib/auth/dal";
import { Badge, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmedAction } from "../../../_components/ConfirmedAction";
import { formatDateTime, humanize } from "../../../_components/format";
import { MaskedAccountNumber } from "../../../_components/MaskedAccountNumber";
import { OrderRows } from "../../../_components/OrderRows";
import { OwnerMoney } from "../../../_components/OwnerMoney";
import { PageHeader } from "../../../_components/PageHeader";
import { RatingsTable } from "../../../_components/RatingsTable";
import { Fields, Section } from "../../../_components/Section";
import { StatusPill } from "../../../_components/StatusPill";
import { RiderDocuments } from "./_components/RiderDocuments";

export const metadata: Metadata = { title: "Rider" };

export default async function AdminRiderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminContext();
  const financeAccess = await canManageFinance();

  const { id } = await params;
  const detail = await getRiderDetail(id);
  if (!detail) notFound();

  const { rider, bank, profile, documents, balance, recentPayouts, recentDeliveries, recentRatings } = detail;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={profile?.fullName ?? "Rider"}
        description={[profile?.phone, "Check this rider's documents, approve them, and pay what they are owed."].filter(Boolean).join(" · ")}
        actions={
          profile?.status === "suspended" ? (
            <StatusPill status="suspended" />
          ) : (
            <StatusPill status={rider.kyc_status} label={rider.kyc_status === "pending" ? "Pending approval" : undefined} />
          )
        }
      />

      <Section title="Rider details">
        <Fields
          items={[
            {
              label: "Account",
              value: (
                <Link href={`/admin/users/${rider.user_id}`} className="text-brand-600 hover:underline">
                  Open account (to suspend or reinstate)
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


      <Section title="Identity documents">
        <RiderDocuments documents={documents} />
      </Section>

      <Section title="Approve or reject this rider">
        <p className="mb-3 text-sm text-ink-muted">
          Approving a rider lets them take deliveries. It is separate from approving each document, so check every document first. It does not move any money.
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

      <OwnerMoney
        ownerType="rider"
        ownerId={rider.user_id}
        ownerName={profile?.fullName ?? "this rider"}
        owedKobo={balance?.balanceKobo ?? 0}
        paidKobo={balance?.disbursedKobo ?? 0}
        bank={
          bank ? (
            <span className="flex flex-col">
              <span>
                {bank.bankName} · {bank.accountName}
              </span>
              <MaskedAccountNumber masked={bank.maskedNumber} fullNumber={bank.fullNumber} />
            </span>
          ) : (
            "The rider has not added bank details"
          )
        }
        canRecord={financeAccess}
        payouts={recentPayouts}
      />

      <Section title="Recent ratings">
        {recentRatings.length === 0 ? <EmptyState title="No ratings yet" description="Customer ratings for this rider will show up here." /> : <RatingsTable ratings={recentRatings} />}
      </Section>

      <Section title="Recent deliveries">
        {recentDeliveries.length === 0 ? <EmptyState title="No deliveries yet" description="Orders this rider delivers will be listed here." /> : <OrderRows orders={recentDeliveries} />}
      </Section>
    </div>
  );
}
