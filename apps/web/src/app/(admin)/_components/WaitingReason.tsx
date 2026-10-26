import { describeAttentionReason, describeLastAttempt, describeWaiting, type WaitingOrder } from "@/lib/admin/dispatch-info";
import Link from "next/link";

/** The plain-language reason an order has no rider, what to do, and the last attempt. Shared by the Waiting for a rider page and the order page. */
export function WaitingReason({ order }: { order: WaitingOrder }) {
  const { headline, action, mentionsSettings } = describeWaiting(order);
  const lastAttempt = describeLastAttempt(order);
  // The system can flag an order while another reason is the freshest one to show.
  const flagged = order.needsAttention && order.reason !== "needs_attention" ? describeAttentionReason(order.attentionReason) : null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      {flagged && <p className="font-semibold text-danger">Needs attention: {flagged}.</p>}
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
