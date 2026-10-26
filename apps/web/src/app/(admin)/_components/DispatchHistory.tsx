import { formatResponseTime, type DispatchHistory as History } from "@/lib/admin/dispatch-history";
import { formatTravel } from "@/lib/admin/dispatch-info";
import { formatKm } from "@/lib/admin/dispatch-settings-info";
import { formatLagosDateTime, formatLagosTime } from "@/lib/time";
import { EmptyState } from "@kiakia/ui";
import { Fields, Section } from "./Section";
import { StatusPill } from "./StatusPill";
import { Table, Td, Th, Tr } from "./Table";

/**
 * Who was asked for an order, how each rider answered, and what the system did,
 * all in plain words. Shown on the Waiting for a rider history page and on the
 * order page; both read the same admin_dispatch_order_history() document.
 */
export function DispatchHistory({ history }: { history: History }) {
  const { offers, events } = history;

  return (
    <Section title="Dispatch history">
      <div className="flex flex-col gap-6">
        {history.deliveredByStore && <p className="text-sm text-ink-muted">The store is delivering this order itself, so no riders are asked.</p>}

        <Fields
          items={[
            { label: "Where the search stands", value: history.stateText },
            { label: "Round", value: history.roundNo > 0 ? String(history.roundNo) : "Not started" },
            { label: "Food expected ready", value: formatLagosTime(history.expectedReadyAt) },
            { label: "Search planned to start", value: formatLagosTime(history.startAt) },
            { label: "Rider assigned", value: formatLagosDateTime(history.assignedAt) },
            { label: "Rider first expected at the store", value: formatLagosTime(history.assignedEtaAt) },
            { label: "Rider now expected at the store", value: formatLagosTime(history.currentEtaAt) },
            { label: "Rider arrived at the store", value: formatLagosTime(history.riderArrivedAt) },
          ]}
        />

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink">Riders asked</h3>
          {offers.length === 0 ? (
            <EmptyState title="No riders have been asked yet" />
          ) : (
            <Table
              head={
                <>
                  <Th>Rider</Th>
                  <Th>Round</Th>
                  <Th>Ask</Th>
                  <Th>Distance</Th>
                  <Th>Would reach the store in</Th>
                  <Th>What happened</Th>
                  <Th>Asked at</Th>
                  <Th>Took to answer</Th>
                </>
              }
            >
              {offers.map((offer) => (
                <Tr key={offer.offerId}>
                  <Td>{offer.riderName}</Td>
                  <Td>{offer.roundNo}</Td>
                  <Td>{offer.attemptNo}</Td>
                  <Td>{offer.distanceM === null ? "—" : formatKm(offer.distanceM)}</Td>
                  <Td>{offer.etaSeconds === null ? "—" : formatTravel(offer.etaSeconds)}</Td>
                  <Td>
                    <StatusPill status={offer.status} label={offer.outcome} />
                  </Td>
                  <Td>{formatLagosDateTime(offer.offeredAt) ?? "—"}</Td>
                  <Td>{formatResponseTime(offer.secondsToRespond) ?? "—"}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink">Key moments</h3>
          {events.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing recorded yet.</p>
          ) : (
            <ol className="flex flex-col gap-1.5 text-sm">
              {events.map((event, index) => (
                <li key={`${event.at}-${index}`} className="flex gap-3">
                  <time dateTime={event.at} className="w-28 shrink-0 text-ink-muted">
                    {formatLagosDateTime(event.at)}
                  </time>
                  <span className="text-ink">{event.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Section>
  );
}
