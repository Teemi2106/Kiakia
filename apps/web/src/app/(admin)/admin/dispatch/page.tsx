import { getDispatchMetrics, getDispatchStatus } from "@/lib/admin/dispatch";
import { beingHandled, formatWaiting, needsAttention, type UpcomingOrder } from "@/lib/admin/dispatch-info";
import { getDispatchHealth } from "@/lib/admin/dispatch-health";
import { requireAdminContext } from "@/lib/auth/dal";
import { formatLagosTime } from "@/lib/time";
import { EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { DispatchHealthNotice } from "../../_components/DispatchHealthNotice";
import { PageHeader } from "../../_components/PageHeader";
import { Section } from "../../_components/Section";
import { DispatchMetricsPanel } from "./_components/DispatchMetricsPanel";
import { WaitingOrderCard } from "./_components/WaitingOrderCard";

export const metadata: Metadata = { title: "Waiting for a rider" };

function UpcomingList({ orders }: { orders: readonly UpcomingOrder[] }) {
  return (
    <Section title={`Search starts later (${orders.length})`}>
      <p className="mb-3 text-sm text-ink-muted">
        These orders were accepted and the food is still being prepared. The system starts looking for a rider shortly before it is ready, so nothing needs doing.
      </p>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {orders.map((order) => (
          <li key={order.orderId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-ink">
              <Link href={`/admin/orders/${order.orderId}`} className="font-medium text-brand-600 hover:underline">
                {order.orderCode}
              </Link>
              {order.vendorName ? ` · ${order.vendorName}` : ""}
            </span>
            <span className="text-ink-muted">
              Food expected ready {formatLagosTime(order.expectedReadyAt) ?? "—"} · search starts {formatLagosTime(order.startAt) ?? "—"} (in {formatWaiting(order.startsInSeconds)})
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default async function WaitingForRiderPage() {
  await requireAdminContext();
  const [status, metrics, health] = await Promise.all([getDispatchStatus(), getDispatchMetrics(), getDispatchHealth()]);
  const stuck = needsAttention(status.orders);
  const handled = beingHandled(status.orders);
  const hasLiveOffer = status.orders.some((order) => order.liveOffer !== null);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title="Waiting for a rider"
        description={`Riders are asked one at a time, nearest first. A background timer starts and moves along each search, and its health is shown here. This page refreshes by itself every ${hasLiveOffer ? 10 : 15} seconds.`}
      />
      {(status.orders.length > 0 || status.upcoming.length > 0 || health.state === "unhealthy") && <AutoRefresh everyMs={hasLiveOffer ? 10_000 : 15_000} />}

      <DispatchHealthNotice health={health} />

      <DispatchMetricsPanel metrics={metrics} />

      {stuck.length === 0 ? (
        <EmptyState title="Nothing needs you right now." description="Orders that get stuck will show up here with the reason." />
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-ink">Needs you ({stuck.length})</h2>
          <ul className="flex flex-col gap-4">
            {stuck.map((order) => (
              <li key={order.orderId}>
                <WaitingOrderCard order={order} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {handled.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-ink-muted">Being searched for ({handled.length})</h2>
          <p className="text-xs text-ink-muted">A rider is being asked or the search is about to start. These are not counted as needing you.</p>
          <ul className="flex flex-col gap-3">
            {handled.map((order) => (
              <li key={order.orderId}>
                <WaitingOrderCard order={order} quiet />
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.upcoming.length > 0 && <UpcomingList orders={status.upcoming} />}
    </div>
  );
}
