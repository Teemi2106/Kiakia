import type { OrderEventView } from "@/lib/admin/orders";
import { OrderStatusBadge } from "@kiakia/ui";
import { formatDateTime, humanize } from "../../../../_components/format";
import { JsonView } from "../../../../_components/JsonView";

const ACTOR_LABELS: Record<string, string> = {
  customer: "the customer",
  vendor: "the store",
  rider: "the rider",
  system: "KiaKia (automatic)",
  admin: "an admin",
};

export function OrderTimeline({ events }: { events: readonly OrderEventView[] }) {
  return (
    <ol className="flex flex-col gap-4 border-l border-border pl-4">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-brand-500" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={event.toStatus} />
            {event.fromStatus && <span className="text-xs text-ink-muted">from {humanize(event.fromStatus)}</span>}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {formatDateTime(event.at)} · by {ACTOR_LABELS[event.actorType] ?? humanize(event.actorType)}
          </p>
          <div className="mt-1">
            <JsonView value={event.meta} />
          </div>
        </li>
      ))}
    </ol>
  );
}
