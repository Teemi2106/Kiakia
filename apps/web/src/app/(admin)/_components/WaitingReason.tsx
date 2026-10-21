import { describeLastAttempt, describeWaiting, type WaitingOrder } from "@/lib/admin/dispatch-info";
import Link from "next/link";

/** The plain-language reason an order has no rider, what to do, and the last attempt. Shared by the Waiting for a rider page and the order page. */
export function WaitingReason({ order }: { order: WaitingOrder }) {
  const { headline, action, mentionsSettings } = describeWaiting(order);
  const lastAttempt = describeLastAttempt(order);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-medium text-ink">{headline}</p>
      <p className="text-ink-muted">
        {action}
        {mentionsSettings && (
          <>
            {" "}
            <Link href="/admin/settings#rider-matching" className="underline">
              Open Rider matching settings
            </Link>
            .
          </>
        )}
      </p>
      {lastAttempt && <p className="text-xs text-ink-muted">{lastAttempt}</p>}
    </div>
  );
}
