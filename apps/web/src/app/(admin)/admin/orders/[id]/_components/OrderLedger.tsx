import type { OrderLedgerEntryView } from "@/lib/admin/orders";
import { formatDateTime, humanize, money } from "../../../../_components/format";
import { accountLabel, transactionKindLabel } from "../../../../_components/labels";
import { Table, Td, Th, Tr } from "../../../../_components/Table";

export function OrderLedger({ entries }: { entries: readonly OrderLedgerEntryView[] }) {
  return (
    <Table
      head={
        <>
          <Th>What happened</Th>
          <Th>Account</Th>
          <Th>Type</Th>
          <Th className="text-right">Balance goes down</Th>
          <Th className="text-right">Balance goes up</Th>
          <Th>When</Th>
        </>
      }
    >
      {entries.map((entry) => (
        <Tr key={entry.id}>
          <Td>
            <p className="font-mono text-xs">{entry.transactionReference}</p>
            <p className="text-xs text-ink-muted">{transactionKindLabel(entry.transactionKind)}</p>
          </Td>
          <Td>{accountLabel(entry.account)}</Td>
          <Td>{humanize(entry.entryType)}</Td>
          <Td className="text-right">{entry.direction === "debit" ? money(entry.amountKobo) : ""}</Td>
          <Td className="text-right">{entry.direction === "credit" ? money(entry.amountKobo) : ""}</Td>
          <Td>{formatDateTime(entry.createdAt)}</Td>
        </Tr>
      ))}
    </Table>
  );
}
