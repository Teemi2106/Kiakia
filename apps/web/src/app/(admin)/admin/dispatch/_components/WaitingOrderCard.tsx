import { describeDistances, formatTravel, formatWaiting, type WaitingOrder } from "@/lib/admin/dispatch-info";
import { formatKm } from "@/lib/admin/dispatch-settings-info";
import { formatLagosTime } from "@/lib/time";
import { Badge } from "@kiakia/ui";
import Link from "next/link";
import { RedispatchButton } from "../../../_components/RedispatchButton";
import { Fields, Section } from "../../../_components/Section";
import { WaitingReason } from "../../../_components/WaitingReason";

function liveOfferText(order: WaitingOrder): string {
  const offer = order.liveOffer;
  if (!offer) return "Nobody right now";
  const eta = offer.etaSeconds === null ? "" : `; would reach the store in ${formatTravel(offer.etaSeconds)}`;
  return `${offer.riderName ?? "A rider"} (ask ${offer.attemptNo}), ${offer.secondsLeft}s left${eta}`;
}

/** One order with no rider yet. `quiet` orders are being searched on schedule, so the funnel numbers are left out. */
export function WaitingOrderCard({ order, quiet }: { order: WaitingOrder; quiet?: boolean }) {
  const highlighted = order.needsAttention;
  return (
    <div className={highlighted ? "rounded-card ring-2 ring-warning" : undefined}>
      <Section
        title={`Order ${order.orderCode}`}
        aside={
          <span className="flex items-center gap-2">
            {highlighted && <Badge tone="danger">Needs attention</Badge>}
            <Badge tone={quiet ? "neutral" : "warning"}>Waiting {formatWaiting(order.waitingSeconds)}</Badge>
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <Fields
            items={[
              { label: "Store", value: order.vendorName ?? "Unknown store" },
              { label: "Being asked now", value: liveOfferText(order) },
              { label: "Round", value: order.roundNo > 0 ? String(order.roundNo) : "Not started" },
              { label: "Riders asked so far", value: String(order.attemptsMade) },
              { label: "Food expected ready", value: formatLagosTime(order.expectedReadyAt) },
              { label: "Search planned to start", value: formatLagosTime(order.startAt) },
              ...(quiet
                ? []
                : [
                    { label: "Riders online", value: String(order.ridersOnline) },
                    {
                      label: "Within the first distance",
                      value: order.radiusM > 0 ? `${order.ridersWithinRadius} (within ${formatKm(order.radiusM)})` : `${order.ridersWithinRadius} (no limit is set)`,
                    },
                    {
                      label: "Within this store's delivery distance",
                      value: order.storeRadiusM > 0 ? `${order.ridersWithinStoreRadius} (within ${formatKm(order.storeRadiusM)})` : String(order.ridersWithinStoreRadius),
                    },
                    { label: "Nearest online rider", value: order.nearestRiderM === null ? "Nobody is online" : `${formatKm(order.nearestRiderM)} from the store` },
                  ]),
            ]}
          />
          {!quiet && <p className="text-sm text-ink-muted">{describeDistances(order)}</p>}
          <WaitingReason order={order} />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span className="flex flex-wrap gap-4 text-sm">
              <Link href={`/admin/orders/${order.orderId}`} className="text-brand-600 hover:underline">
                Open order {order.orderCode}
              </Link>
              <Link href={`/admin/dispatch/${order.orderId}`} className="text-brand-600 hover:underline">
                History
              </Link>
            </span>
            <RedispatchButton orderId={order.orderId} />
          </div>
        </div>
      </Section>
    </div>
  );
}
