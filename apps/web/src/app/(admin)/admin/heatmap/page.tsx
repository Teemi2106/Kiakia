import { FleetMap } from "@/app/(fleet)/_components/FleetMap";
import type { MapRider } from "@/app/(fleet)/_components/FleetMapbox";
import { HEATMAP_WINDOWS, loadHeatmap, parseHeatmapWindow } from "@/lib/admin/heatmap";
import { requireAdminContext } from "@/lib/auth/dal";
import { HOTSPOT_RADIUS_M, rankHotspotsNear } from "@/lib/fleet/fleet-info";
import { Card, cn, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { PageHeader } from "../../_components/PageHeader";
import { Table, Td, Th, Tr } from "../../_components/Table";

export const metadata: Metadata = { title: "Demand heatmap" };

export default async function AdminHeatmapPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireAdminContext();
  const raw = await searchParams;
  const hours = parseHeatmapWindow(typeof raw.hours === "string" ? raw.hours : undefined);

  const { cells, riders } = await loadHeatmap(hours);
  const totalOrders = cells.reduce((sum, cell) => sum + cell.orders, 0);
  const free = riders.filter((rider) => rider.isLive && !rider.onDelivery);
  const hotspots = rankHotspotsNear(cells, free, 12);

  const mapRiders: MapRider[] = riders.map((rider) => ({
    userId: rider.userId,
    fullName: rider.fullName,
    status: rider.onDelivery ? "delivering" : rider.isLive ? "available" : "no_signal",
    lat: rider.lat,
    lng: rider.lng,
    destination: null,
  }));

  const stats = [
    { label: `Orders, last ${hours} ${hours === 1 ? "hour" : "hours"}`, value: totalOrders },
    { label: "Riders online", value: riders.length },
    { label: "On a delivery", value: riders.filter((rider) => rider.onDelivery).length },
    { label: "Online, free", value: free.length },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader
        title="Demand heatmap"
        description="Where orders are coming from across the whole platform, and where every online rider is. Areas with no free riders nearby are where deliveries are most likely to wait."
      />
      <AutoRefresh everyMs={30_000} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="text-xs uppercase tracking-wide text-ink-muted">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{stat.value}</p>
          </Card>
        ))}
      </div>

      <nav aria-label="Time window" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">Orders in the last</span>
        {HEATMAP_WINDOWS.map((value) => (
          <Link
            key={value}
            href={`/admin/heatmap?hours=${value}`}
            aria-current={value === hours ? "true" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 font-medium transition-colors",
              value === hours ? "border-brand-500 bg-brand-50 text-brand-700" : "border-border text-ink-muted hover:text-ink",
            )}
          >
            {value} {value === 1 ? "hour" : "hours"}
          </Link>
        ))}
      </nav>

      <FleetMap cells={cells} riders={mapRiders} />

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span><span className="mr-1 inline-block size-2.5 rounded-full bg-[#16a34a]" />Online, free</span>
        <span><span className="mr-1 inline-block size-2.5 rounded-full bg-[#d97706]" />On a delivery</span>
        <span><span className="mr-1 inline-block size-2.5 rounded-full bg-[#9ca3af]" />Online, no signal</span>
      </p>

      <h2 className="mt-2 text-base font-semibold text-ink">Busiest areas</h2>
      {hotspots.length === 0 ? (
        <EmptyState title="No orders in this window" description="Try a longer time window." />
      ) : (
        <Table
          head={
            <>
              <Th>#</Th>
              <Th>Orders</Th>
              <Th>{`Free riders within ${HOTSPOT_RADIUS_M / 1000} km`}</Th>
              <Th>Area</Th>
            </>
          }
        >
          {hotspots.map((spot) => (
            <Tr key={`${spot.lat}:${spot.lng}`}>
              <Td>{spot.rank}</Td>
              <Td className="font-medium">{spot.orders}</Td>
              <Td className={spot.freeRidersNearby === 0 ? "font-medium text-danger" : undefined}>
                {spot.freeRidersNearby === 0 ? "None, riders needed" : spot.freeRidersNearby}
              </Td>
              <Td>
                <a
                  href={`https://www.google.com/maps?q=${spot.lat},${spot.lng}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand-600 hover:underline"
                >
                  Open in Maps
                </a>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </div>
  );
}
