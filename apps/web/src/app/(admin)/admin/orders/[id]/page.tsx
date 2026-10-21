import { getWaitingForOrder } from "@/lib/admin/dispatch";
import { getOrderDetail, listAssignableRiders } from "@/lib/admin/orders";
import { formatWaiting } from "@/lib/admin/dispatch-info";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, EmptyState, OrderStatusBadge } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fields, Section } from "../../../_components/Section";
import { formatAddress, formatDateTime, humanize, money } from "../../../_components/format";
import { JsonView } from "../../../_components/JsonView";
import { PageHeader } from "../../../_components/PageHeader";
import { StatusPill } from "../../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../../_components/Table";
import { OrderActions } from "./_components/OrderActions";
import { OrderLedger } from "./_components/OrderLedger";
import { OrderTimeline } from "./_components/OrderTimeline";
import { RedispatchButton } from "../../../_components/RedispatchButton";
import { WaitingReason } from "../../../_components/WaitingReason";

export const metadata: Metadata = { title: "Order" };

const ESCROW_LABELS = {
  none: "No payment received",
  held: "Held until delivery",
  released: "Paid out after delivery",
  refunded: "Refunded",
} as const;

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminContext();

  const { id } = await params;
  const [detail, waiting] = await Promise.all([getOrderDetail(id), getWaitingForOrder(id)]);
  if (!detail) notFound();

  const assignableRiders = detail.canReassignRider ? await listAssignableRiders(id) : [];

  const { order, items, events, payment, ledger, escrow, dispatchOffers, vendor, customer, rider } = detail;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={`Order ${order.code}`}
        description={`Placed ${formatDateTime(order.created_at)}. Everything about this order: who is involved, what was paid, and what happened.`}
        actions={<OrderStatusBadge status={order.status} />}
      />

      {waiting && (
        <div role="status" className="flex flex-col gap-3 rounded-card border border-warning bg-warning-surface px-4 py-3">
          <p className="text-sm font-semibold text-ink">This order is waiting for a rider (for {formatWaiting(waiting.waitingSeconds)}).</p>
          <WaitingReason order={waiting} />
          <RedispatchButton orderId={waiting.orderId} />
        </div>
      )}

      <OrderActions detail={detail} assignableRiders={assignableRiders} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="People">
          <Fields
            items={[
              {
                label: "Vendor",
                value: vendor ? (
                  <Link href={`/admin/vendors/${vendor.id}`} className="text-brand-600 hover:underline">
                    {vendor.name}
                  </Link>
                ) : null,
              },
              {
                label: "Customer",
                value: customer ? (
                  <Link href={`/admin/customers/${customer.id}`} className="text-brand-600 hover:underline">
                    {customer.fullName ?? customer.id}
                  </Link>
                ) : null,
              },
              { label: "Customer phone", value: customer?.phone },
              {
                label: "Rider",
                value: rider ? (
                  <Link href={`/admin/riders/${rider.id}`} className="text-brand-600 hover:underline">
                    {rider.fullName ?? rider.id}
                  </Link>
                ) : (
                  "Not assigned"
                ),
              },
              { label: "Delivery address", value: formatAddress(order.delivery_address) },
              { label: "Delivery note", value: order.delivery_note },
            ]}
          />
        </Section>

        <Section title="Payment">
          <Fields
            items={[
              { label: "Subtotal", value: money(order.subtotal_kobo) },
              { label: "Delivery fee", value: money(order.delivery_fee_kobo) },
              { label: "Service fee", value: money(order.service_fee_kobo) },
              { label: "Discount", value: order.discount_kobo > 0 ? money(order.discount_kobo) : null },
              { label: "Total", value: <strong>{money(order.total_kobo)}</strong> },
              { label: "Order payment", value: <StatusPill status={order.payment_status} label={order.payment_status === "pending" ? "Awaiting payment" : undefined} /> },
              { label: "Method", value: order.payment_method ? humanize(order.payment_method) : null },
              {
                label: "Customer's money",
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={escrow.state === "held" ? "warning" : "neutral"}>{ESCROW_LABELS[escrow.state]}</Badge>
                    {escrow.refundDestination && <span>{escrow.refundDestination === "gateway" ? "back to their card or bank" : "to their KiaKia wallet"}</span>}
                  </span>
                ),
              },
              ...(payment
                ? [
                    { label: "Monnify reference", value: <span className="font-mono text-xs">{payment.providerRef}</span> },
                    { label: "Card or bank payment", value: <StatusPill status={payment.status} /> },
                    {
                      label: "Refund",
                      value: payment.refundReference ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs">{payment.refundReference}</span>
                          {payment.refundStatus && <StatusPill status={payment.refundStatus} />}
                          {payment.refundStatus !== "completed" && (
                            <span className="text-xs text-ink-muted">Check Monnify for the current status.</span>
                          )}
                        </span>
                      ) : escrow.refundDestination === "gateway" ? (
                        <Badge tone="danger">Not requested</Badge>
                      ) : null,
                    },
                  ]
                : []),
            ]}
          />
        </Section>
      </div>

      <Section title="Items">
        <Table
          head={
            <>
              <Th>Item</Th>
              <Th className="text-right">Price each</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Line total</Th>
            </>
          }
        >
          {items.map((item) => (
            <Tr key={item.id}>
              <Td>
                {item.name}
                <JsonView value={item.options} />
              </Td>
              <Td className="text-right">{money(item.unitPriceKobo)}</Td>
              <Td className="text-right">{item.qty}</Td>
              <Td className="text-right">{money(item.lineTotalKobo)}</Td>
            </Tr>
          ))}
        </Table>
      </Section>

      <Section title="What happened">
        {events.length === 0 ? <EmptyState title="Nothing recorded yet" /> : <OrderTimeline events={events} />}
      </Section>

      <Section title="Money records">
        {ledger.length === 0 ? <EmptyState title="No money records" description="No payment has been received for this order." /> : <OrderLedger entries={ledger} />}
      </Section>

      <Section title="Offers sent to riders">
        {dispatchOffers.length === 0 ? (
          <EmptyState title="No offers sent to riders yet" />
        ) : (
          <Table
            head={
              <>
                <Th>Rider</Th>
                <Th>Status</Th>
                <Th>Offered</Th>
                <Th>Responded</Th>
              </>
            }
          >
            {dispatchOffers.map((offer) => (
              <Tr key={offer.id}>
                <Td>
                  <Link href={`/admin/riders/${offer.riderId}`} className="text-brand-600 hover:underline">
                    {offer.riderName ?? offer.riderId}
                  </Link>
                </Td>
                <Td>
                  <StatusPill status={offer.status} />
                </Td>
                <Td>{formatDateTime(offer.offeredAt)}</Td>
                <Td>{offer.respondedAt ? formatDateTime(offer.respondedAt) : "—"}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
