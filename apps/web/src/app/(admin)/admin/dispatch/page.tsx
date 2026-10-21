import { listWaitingForRider } from "@/lib/admin/dispatch";
import { formatKm } from "@/lib/admin/dispatch-settings-info";
import { describeDistances, formatWaiting } from "@/lib/admin/dispatch-info";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { PageHeader } from "../../_components/PageHeader";
import { RedispatchButton } from "../../_components/RedispatchButton";
import { Fields, Section } from "../../_components/Section";
import { WaitingReason } from "../../_components/WaitingReason";

export const metadata: Metadata = { title: "Waiting for a rider" };

export default async function WaitingForRiderPage() {
  await requireAdminContext();
  const orders = await listWaitingForRider();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title="Waiting for a rider"
        description="Orders that are ready for pickup but have no rider and no offer a rider could still accept. This page refreshes by itself every 15 seconds."
      />
      {orders.length > 0 && <AutoRefresh everyMs={15_000} />}

      {orders.length === 0 ? (
        <EmptyState title="Every ready order has a rider or a pending offer." description="Orders that get stuck will show up here with the reason." />
      ) : (
        <ul className="flex flex-col gap-4">
          {orders.map((order) => (
            <li key={order.orderId}>
              <Section
                title={`Order ${order.orderCode}`}
                aside={<Badge tone="warning">Waiting {formatWaiting(order.waitingSeconds)}</Badge>}
              >
                <div className="flex flex-col gap-4">
                  <Fields
                    items={[
                      { label: "Store", value: order.vendorName ?? "Unknown store" },
                      { label: "Riders online", value: String(order.ridersOnline) },
                      { label: "Within the normal distance", value: order.radiusM > 0 ? `${order.ridersWithinRadius} (within ${formatKm(order.radiusM)})` : `${order.ridersWithinRadius} (no limit is set)` },
                      {
                        label: "Within this store's delivery distance",
                        value: order.storeRadiusM ? `${order.ridersWithinStoreRadius} (within ${formatKm(order.storeRadiusM)})` : String(order.ridersWithinStoreRadius),
                      },
                      { label: "Nearest online rider", value: order.nearestRiderM === null ? "Nobody is online" : `${formatKm(order.nearestRiderM)} from the store` },
                    ]}
                  />
                  <p className="text-sm text-ink-muted">{describeDistances(order)}</p>
                  <WaitingReason order={order} />
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Link href={`/admin/orders/${order.orderId}`} className="text-sm text-brand-600 hover:underline">
                      Open order {order.orderCode}
                    </Link>
                    <RedispatchButton orderId={order.orderId} />
                  </div>
                </div>
              </Section>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
