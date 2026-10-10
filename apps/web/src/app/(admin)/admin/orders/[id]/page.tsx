import { getOrderDetail, listAssignableRiders } from "@/lib/admin/orders";
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

export const metadata: Metadata = { title: "Order" };

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminContext();

  const { id } = await params;
  const detail = await getOrderDetail(id);
  if (!detail) notFound();

  const assignableRiders = detail.canReassignRider ? await listAssignableRiders(id) : [];

  const { order, items, events, payment, ledger, escrow, dispatchOffers, vendor, customer, rider } = detail;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={`Order ${order.code}`}
        description={`Placed ${formatDateTime(order.created_at)}`}
        actions={<OrderStatusBadge status={order.status} />}
      />

      <OrderActions detail={detail} assignableRiders={assignableRiders} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Parties">
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
                  <Link href={`/admin/users/${customer.id}`} className="text-brand-600 hover:underline">
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
              { label: "Order payment", value: <StatusPill status={order.payment_status} /> },
              { label: "Method", value: order.payment_method ? humanize(order.payment_method) : null },
              {
                label: "Escrow",
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={escrow.state === "held" ? "warning" : "neutral"}>{humanize(escrow.state)}</Badge>
                    {escrow.refundDestination && <span>to {escrow.refundDestination}</span>}
                  </span>
                ),
              },
              ...(payment
                ? [
                    { label: "Provider reference", value: <span className="font-mono text-xs">{payment.providerRef}</span> },
                    { label: "Gateway payment", value: <StatusPill status={payment.status} /> },
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
              <Th className="text-right">Unit price</Th>
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

      <Section title="Timeline">
        {events.length === 0 ? <EmptyState title="No events recorded" /> : <OrderTimeline events={events} />}
      </Section>

      <Section title="Ledger entries">
        {ledger.length === 0 ? <EmptyState title="No ledger entries" description="No payment has been captured for this order." /> : <OrderLedger entries={ledger} />}
      </Section>

      <Section title="Dispatch offers">
        {dispatchOffers.length === 0 ? (
          <EmptyState title="No dispatch offers" />
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
