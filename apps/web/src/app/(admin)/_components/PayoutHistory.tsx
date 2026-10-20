import type { PayoutHistoryItem, PayoutRecord } from "@/lib/admin/finance";
import { EmptyState } from "@kiakia/ui";
import Link from "next/link";
import { formatDateTime, money } from "./format";
import { Table, Td, Th, Tr } from "./Table";

/** Payouts already marked as paid. Pass `showOwner` rows (PayoutHistoryItem) for the all-payouts view. */
export function PayoutHistory({
  payouts,
  emptyTitle = "No payouts recorded yet",
}: {
  payouts: readonly (PayoutRecord | PayoutHistoryItem)[];
  emptyTitle?: string;
}) {
  if (payouts.length === 0) return <EmptyState title={emptyTitle} description="Payouts appear here once someone marks them as paid." />;

  const showOwner = "ownerId" in payouts[0];
  return (
    <Table
      head={
        <>
          <Th>Date</Th>
          {showOwner && <Th>Paid to</Th>}
          <Th className="text-right">Amount</Th>
          <Th>Bank reference</Th>
          <Th>Recorded by</Th>
          <Th>Note</Th>
        </>
      }
    >
      {payouts.map((payout) => (
        <Tr key={payout.auditId}>
          <Td>{formatDateTime(payout.createdAt)}</Td>
          {"ownerId" in payout && (
            <Td>
              <Link
                href={`/admin/${payout.ownerType === "vendor" ? "vendors" : "riders"}/${payout.ownerId}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {payout.ownerName ?? "Unknown"}
              </Link>
              <p className="text-xs text-ink-muted">{payout.ownerType === "vendor" ? "Vendor" : "Rider"}</p>
            </Td>
          )}
          <Td className="text-right">{money(payout.amountKobo)}</Td>
          <Td className="font-mono text-xs">{payout.reference}</Td>
          <Td>{payout.recordedBy ?? "—"}</Td>
          <Td className="max-w-64 break-words">{payout.note ?? "—"}</Td>
        </Tr>
      ))}
    </Table>
  );
}
