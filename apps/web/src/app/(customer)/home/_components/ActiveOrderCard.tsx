// app/(customer)/home/_components/ActiveOrderCard.tsx
import { formatNaira, koboOf, type OrderStatus } from "@kiakia/domain";
import { cn } from "@kiakia/ui";
import { ArrowRight, ChefHat, Bike, DoorOpen, Receipt, type LucideIcon } from "lucide-react";
import Link from "next/link";

export interface ActiveOrder {
  id: string;
  code: string;
  status: OrderStatus;
  total_kobo: number;
  vendorName: string | null;
}

/**
 * The four beats a customer actually cares about, collapsed from the
 * fourteen-state machine in @kiakia/domain. Anything terminal never reaches
 * this component — page.tsx filters those out at the query.
 */
const STAGES: ReadonlyArray<{
  label: string;
  icon: LucideIcon;
  statuses: readonly OrderStatus[];
}> = [
  { label: "Confirming", icon: Receipt, statuses: ["draft", "placed", "accepted"] },
  { label: "In the kitchen", icon: ChefHat, statuses: ["preparing", "ready_for_pickup"] },
  { label: "On the way", icon: Bike, statuses: ["rider_assigned", "picked_up", "in_transit"] },
  { label: "At your door", icon: DoorOpen, statuses: ["arrived"] },
];

function stageIndexFor(status: OrderStatus): number {
  const index = STAGES.findIndex((stage) => stage.statuses.includes(status));
  // A status this component hasn't been taught about should read as "early",
  // not crash and not silently claim the order is at the door.
  return index === -1 ? 0 : index;
}

/**
 * The one thing a customer opening the app mid-order wants to see, above
 * everything else on the page. Only rendered when there is a live order —
 * an empty version of this would be a permanent piece of furniture asking to
 * be ignored.
 */
export function ActiveOrderCard({
  order,
  otherActiveCount,
}: {
  order: ActiveOrder;
  otherActiveCount: number;
}) {
  const current = stageIndexFor(order.status);
  const CurrentIcon = STAGES[current].icon;

  return (
    <section
      aria-label="Your live order"
      className="relative overflow-hidden rounded-3xl bg-kk-ink-deep p-5 text-white shadow-[0_30px_60px_-32px_rgba(18,13,12,0.9)] sm:p-7"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-kk-red/25 blur-3xl"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <span className="flex items-center gap-2 font-inter text-[11px] font-semibold uppercase tracking-[0.2em] text-kk-mint">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-kk-mint opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-kk-mint" />
            </span>
            Live order
          </span>

          <p className="mt-3 flex items-center gap-2.5 font-sora text-xl font-bold tracking-tight sm:text-2xl">
            <CurrentIcon className="size-5 shrink-0 text-kk-orange" />
            {STAGES[current].label}
          </p>

          <p className="mt-1.5 truncate font-inter text-sm text-white/55">
            {order.vendorName ?? "Your order"} · #{order.code} ·{" "}
            {formatNaira(koboOf(order.total_kobo))} held in escrow
          </p>
        </div>

        <Link
          href={`/orders/${order.id}/tracking`}
          className="group inline-flex shrink-0 items-center gap-2 rounded-2xl bg-white px-5 py-3 font-inter text-sm font-semibold text-kk-ink-deep transition-transform duration-300 hover:-translate-y-0.5"
        >
          Track it
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
      </div>

      {/* Progress rail. Each segment fills once the order has reached it. */}
      <ol className="relative mt-7 grid grid-cols-4 gap-2">
        {STAGES.map((stage, i) => {
          const reached = i <= current;
          return (
            <li key={stage.label} className="min-w-0">
              <span
                className={cn(
                  "block h-1 rounded-full transition-colors",
                  reached ? "bg-gradient-to-r from-kk-orange to-kk-red" : "bg-white/15",
                )}
              />
              <span
                className={cn(
                  "mt-2 block truncate font-inter text-[11px]",
                  i === current ? "font-semibold text-white" : "text-white/40",
                )}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>

      {otherActiveCount > 0 && (
        <Link
          href="/orders"
          className="relative mt-5 inline-block font-inter text-xs font-semibold text-kk-mint underline underline-offset-4 hover:text-white"
        >
          + {otherActiveCount} more {otherActiveCount === 1 ? "order" : "orders"} in progress
        </Link>
      )}
    </section>
  );
}
