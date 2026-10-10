import { getDashboardMetrics } from "@/lib/admin/finance";
import { listFlaggedOrders } from "@/lib/admin/flagged";
import { listOrders, type OrderListItem } from "@/lib/admin/orders";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Card, CardBody, EmptyState, OrderStatusBadge } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime, humanize, money } from "../_components/format";
import { PageHeader } from "../_components/PageHeader";
import { Section } from "../_components/Section";

export const metadata: Metadata = { title: "Admin overview" };

const PIPELINE_STATUSES = [
  "placed",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "rider_assigned",
  "picked_up",
  "in_transit",
  "arrived",
] as const;

export default async function AdminOverviewPage() {
  await requireAdminContext();

  const [metrics, flagged, readyOrders, arrivedOrders, failedOrders] = await Promise.all([
    getDashboardMetrics(),
    listFlaggedOrders({ pageSize: 5 }),
    listOrders({ status: "ready_for_pickup", pageSize: 5 }),
    listOrders({ status: "arrived", pageSize: 5 }),
    listOrders({ status: "failed_delivery", pageSize: 5 }),
  ]);

  const { stuck_orders: stuck, capture_anomalies_7d: anomalies, gateway_refunds: refunds } = metrics;
  const anomalyTotal = anomalies.duplicate_capture + anomalies.underpaid_capture + anomalies.amount_mismatch;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader title="Overview" description={`Updated ${formatDateTime(metrics.generated_at)}`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Delivered, 24h" value={String(metrics.delivered.last_24h.orders)} hint={money(metrics.delivered.last_24h.gmv_kobo)} />
        <Metric label="Delivered, 7d" value={String(metrics.delivered.last_7d.orders)} hint={money(metrics.delivered.last_7d.gmv_kobo)} />
        <Metric label="Delivered, 30d" value={String(metrics.delivered.last_30d.orders)} hint={money(metrics.delivered.last_30d.gmv_kobo)} />
        <Metric label="Platform revenue, 30d" value={money(metrics.platform_revenue_30d_kobo)} />
        <Metric label="Riders online" value={String(metrics.riders.online)} />
        <Metric
          label="Riders pending KYC"
          value={String(metrics.riders.pending_kyc)}
          hint={`${metrics.riders.documents_pending} documents to review`}
          href="/admin/riders?kyc=pending"
        />
        <Metric label="Vendors suspended" value={String(metrics.vendors_suspended)} href="/admin/vendors?status=suspended" />
        <Metric
          label="Gateway refunds"
          value={String(refunds.pending + refunds.failed + refunds.not_requested)}
          hint={`${refunds.pending} pending, ${refunds.failed} failed, ${refunds.not_requested} not requested`}
          alert={refunds.failed + refunds.not_requested > 0}
        />
      </div>

      <Section title="Active pipeline">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PIPELINE_STATUSES.map((status) => (
            <Link
              key={status}
              href={`/admin/orders?status=${status}`}
              className="rounded-control border border-border px-3 py-2 hover:bg-surface-sunken"
            >
              <p className="text-xs text-ink-muted">{humanize(status)}</p>
              <p className="text-lg font-semibold text-ink">{metrics.orders_by_status[status]}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Needs attention">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AttentionCount label="Ready, no rider for 15+ min" count={stuck.ready_without_rider} href="/admin/orders?status=ready_for_pickup" />
          <AttentionCount label="Delivery code locked" count={stuck.delivery_code_locked} href="/admin/orders?status=arrived" />
          <AttentionCount label="Failed delivery, escrow held" count={stuck.failed_delivery_escrow_held} href="/admin/orders?status=failed_delivery" />
          <AttentionCount label="Capture anomalies, 7d" count={anomalyTotal} href="/admin/flagged-orders" />
        </ul>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <OrderList title="Ready for pickup" href="/admin/orders?status=ready_for_pickup" orders={readyOrders.rows} />
        <OrderList title="Arrived" href="/admin/orders?status=arrived" orders={arrivedOrders.rows} />
        <OrderList title="Failed deliveries" href="/admin/orders?status=failed_delivery" orders={failedOrders.rows} />

        <Section
          title="Latest flagged orders"
          aside={
            <Link href="/admin/flagged-orders" className="text-sm text-brand-600 hover:underline">
              View all
            </Link>
          }
        >
          {flagged.rows.length === 0 ? (
            <EmptyState title="Nothing flagged" />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {flagged.rows.map((event) => (
                <li key={event.eventId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/admin/orders/${event.orderId}`} className="font-medium text-brand-600 hover:underline">
                    {event.orderCode ?? event.orderId}
                  </Link>
                  <span className="flex flex-wrap justify-end gap-1">
                    {event.anomalies.map((anomaly) => (
                      <Badge key={anomaly} tone="danger">
                        {humanize(anomaly)}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  href,
  alert,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  alert?: boolean;
}) {
  const body = (
    <Card className={alert ? "border-danger" : href ? "hover:bg-surface-sunken" : undefined}>
      <CardBody>
        <p className="text-xs uppercase tracking-wide">{label}</p>
        <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
        {hint && <p className="mt-0.5 text-xs">{hint}</p>}
      </CardBody>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function AttentionCount({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2 hover:bg-surface-sunken"
      >
        <span className="text-sm text-ink">{label}</span>
        <Badge tone={count > 0 ? "danger" : "positive"}>{count}</Badge>
      </Link>
    </li>
  );
}

function OrderList({ title, href, orders }: { title: string; href: string; orders: readonly OrderListItem[] }) {
  return (
    <Section
      title={title}
      aside={
        <Link href={href} className="text-sm text-brand-600 hover:underline">
          View all
        </Link>
      }
    >
      {orders.length === 0 ? (
        <EmptyState title="None right now" />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {orders.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <Link href={`/admin/orders/${order.id}`} className="font-medium text-brand-600 hover:underline">
                  {order.code}
                </Link>
                <p className="truncate text-xs text-ink-muted">
                  {order.vendorName ?? "Unknown vendor"} · {formatDateTime(order.createdAt)}
                </p>
              </div>
              <OrderStatusBadge status={order.status} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
