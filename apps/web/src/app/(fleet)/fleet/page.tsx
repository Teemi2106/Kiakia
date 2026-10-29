import { AutoRefresh } from "@/app/(admin)/_components/AutoRefresh";
import { PageHeader } from "@/app/(admin)/_components/PageHeader";
import { humanize } from "@/app/(admin)/_components/format";
import { loadFleetRiders } from "@/lib/fleet/console";
import { lastSeenText, riderStatus, RIDER_STATUS_LABELS, summarizeRiders, type FleetRider } from "@/lib/fleet/fleet-info";
import { Card, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import { RiderMessagePanel, type RiderRow } from "../_components/RiderMessagePanel";

export const metadata: Metadata = { title: "Fleet riders" };

function deliveryText(rider: FleetRider): string | null {
  const delivery = rider.delivery;
  if (!delivery) return null;
  const route = [delivery.vendorName, delivery.destinationCity].filter(Boolean).join(" → ");
  return `${delivery.orderCode} · ${humanize(delivery.status)}${route ? ` · ${route}` : ""}`;
}

export default async function FleetRidersPage() {
  const { fleetName, riders, loadedAt } = await loadFleetRiders();
  const summary = summarizeRiders(riders);

  const rows: RiderRow[] = riders.map((rider) => {
    const status = riderStatus(rider);
    return {
      userId: rider.userId,
      fullName: rider.fullName,
      phone: rider.phone,
      vehicleType: rider.vehicleType,
      status,
      statusLabel: RIDER_STATUS_LABELS[status],
      deliveryText: deliveryText(rider),
      lastSeen: lastSeenText(rider.lastPingAt, loadedAt),
    };
  });

  const stats = [
    { label: "Riders", value: summary.total },
    { label: "On a delivery", value: summary.delivering },
    { label: "Online, free", value: summary.available },
    { label: "Offline", value: summary.offline + summary.noSignal },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader
        title="Your riders"
        description={`Who is online, who is on a delivery and where they are heading, for ${fleetName}. This page refreshes by itself.`}
      />
      <AutoRefresh everyMs={20_000} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="text-xs uppercase tracking-wide text-ink-muted">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{stat.value}</p>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No riders in your fleet yet" description="KiaKia adds riders to your fleet. Once they are added, they show up here." />
      ) : (
        <RiderMessagePanel riders={rows} />
      )}
    </div>
  );
}
