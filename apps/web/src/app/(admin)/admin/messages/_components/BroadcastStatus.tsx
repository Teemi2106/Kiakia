import { Badge } from "@kiakia/ui";
import type { BroadcastCounts } from "@/lib/admin/messages-map";

/** One word for how a message is going, from its counts. */
export function BroadcastStatus({ counts }: { counts: BroadcastCounts }) {
  if (counts.waiting > 0) return <Badge tone="warning">Sending ({counts.waiting} to go)</Badge>;
  if (counts.failed > 0) return <Badge tone="danger">{counts.failed} failed</Badge>;
  return <Badge tone="positive">Done</Badge>;
}
