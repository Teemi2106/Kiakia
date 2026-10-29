import { AutoRefresh } from "@/app/(admin)/_components/AutoRefresh";
import { PageHeader } from "@/app/(admin)/_components/PageHeader";
import { Table, Td, Th, Tr } from "@/app/(admin)/_components/Table";
import { DEMAND_WINDOWS, loadDemandCells, loadFleetRiders, parseDemandWindow } from "@/lib/fleet/console";
import { HOTSPOT_RADIUS_M, rankHotspots, riderStatus } from "@/lib/fleet/fleet-info";
import { cn, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { FleetMap } from "../../_components/FleetMap";
import type { MapRider } from "../../_components/FleetMapbox";

export const metadata: Metadata = { title: "Map & demand" };

export default async function FleetMapPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const raw = await searchParams;
  const hours = parseDemandWindow(typeof raw.hours === "string" ? raw.hours : undefined);

  const [{ riders }, cells] = await Promise.all([loadFleetRiders(), loadDemandCells(hours)]);
  const hotspots = rankHotspots(cells, riders);

  // Offline riders have no useful position; the map shows who can be sent somewhere.
  const mapRiders: MapRider[] = riders.flatMap((rider) => {
    const status = riderStatus(rider);
    if (status === "offline" || !rider.position) return [];
    return [
      {
        userId: rider.userId,
        fullName: rider.fullName,
        status,
        lat: rider.position.lat,
        lng: rider.position.lng,
        destination: rider.delivery?.destination ?? null,
      },
    ];
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader
        title="Map & demand"
        description="Where orders are coming from across the city, and where your riders are. Send free riders toward the busiest areas."
      />
      <AutoRefresh everyMs={30_000} />

      <nav aria-label="Time window" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">Orders in the last</span>
        {DEMAND_WINDOWS.map((value) => (
          <Link
            key={value}
            href={`/fleet/map?hours=${value}`}
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
        <span><span className="mr-1 inline-block size-2.5 rounded-full bg-[#d97706]" />On a delivery (dashed line to where they are heading)</span>
        <span><span className="mr-1 inline-block size-2.5 rounded-full bg-[#9ca3af]" />No signal</span>
        <span>Areas with fewer than 2 orders are not shown.</span>
      </p>

      <h2 className="mt-2 text-base font-semibold text-ink">Busiest areas</h2>
      {hotspots.length === 0 ? (
        <EmptyState title="No busy areas right now" description="Areas with at least 2 orders in this time window show up here." />
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
                {spot.freeRidersNearby === 0 ? "None, needs riders" : spot.freeRidersNearby}
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
