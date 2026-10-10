import type { OrderLedgerEntryView } from "@/lib/admin/orders";
import { formatDateTime, humanize, money } from "../../../../_components/format";
import { Table, Td, Th, Tr } from "../../../../_components/Table";

export function OrderLedger({ entries }: { entries: readonly OrderLedgerEntryView[] }) {
  return (
    <Table
      head={
        <>
          <Th>Transaction</Th>
          <Th>Account</Th>
          <Th>Entry</Th>
          <Th className="text-right">Debit</Th>
          <Th className="text-right">Credit</Th>
          <Th>When</Th>
        </>
      }
    >
      {entries.map((entry) => (
        <Tr key={entry.id}>
          <Td>
            <p className="font-mono text-xs">{entry.transactionReference}</p>
            <p className="text-xs text-ink-muted">{humanize(entry.transactionKind)}</p>
          </Td>
          <Td>{entry.account}</Td>
          <Td>{humanize(entry.entryType)}</Td>
          <Td className="text-right">{entry.direction === "debit" ? money(entry.amountKobo) : ""}</Td>
          <Td className="text-right">{entry.direction === "credit" ? money(entry.amountKobo) : ""}</Td>
          <Td>{formatDateTime(entry.createdAt)}</Td>
        </Tr>
      ))}
    </Table>
  );
}
