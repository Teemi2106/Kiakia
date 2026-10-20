import { getLedgerHealth, listBalances } from "@/lib/admin/finance";
import { canManageFinance, requireAdminContext } from "@/lib/auth/dal";
import { EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExportForm, defaultExportRange } from "../../_components/ExportForm";
import { money } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";
import { Table, Td, Th, Tr } from "../../_components/Table";
import { LedgerHealthPanel } from "./_components/LedgerHealthPanel";

export const metadata: Metadata = { title: "Finance" };

export default async function AdminFinancePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();
  const financeAccess = await canManageFinance();

  const raw = await searchParams;
  // Vendor and rider balances moved to Payouts; keep old bookmarks working.
  const oldTab = firstParam(raw.tab);
  if (oldTab === "vendor" || oldTab === "rider") redirect("/admin/payouts");

  const [health, wallets] = await Promise.all([getLedgerHealth(), listBalances("customer", { page: pageParam(raw.page) })]);
  const exportRange = defaultExportRange();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Finance"
        description="Check that the money records add up, download them for your accountant, and see customer wallet balances. To pay a vendor or rider, go to Payouts."
        actions={
          <Link href="/admin/payouts" className="text-sm font-medium text-brand-600 hover:underline">
            Go to Payouts
          </Link>
        }
      />

      <LedgerHealthPanel health={health} />

      {financeAccess && (
        <ExportForm
          action="/admin/finance/export"
          idPrefix="ledger-export"
          title="Download money records"
          description="A CSV of every money movement, up to 92 days at a time. Use it to check the books."
          defaultFrom={exportRange.from}
          defaultTo={exportRange.to}
        />
      )}

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Customer wallets</h2>
          <p className="text-sm text-ink-muted">Money customers hold in their KiaKia wallet, for example from refunds. Highest first.</p>
        </div>

        {wallets.rows.length === 0 ? (
          <EmptyState title="No customer wallets yet" description="A wallet appears when a customer is first refunded or tops one up." />
        ) : (
          <Table
            head={
              <>
                <Th>Customer</Th>
                <Th className="text-right">Wallet balance</Th>
              </>
            }
          >
            {wallets.rows.map((row) => (
              <Tr key={row.ownerId}>
                <Td>
                  <Link href={`/admin/customers/${row.ownerId}`} className="font-medium text-brand-600 hover:underline">
                    {row.displayName ?? "Unnamed customer"}
                  </Link>
                </Td>
                <Td className="text-right">{money(row.balanceKobo)}</Td>
              </Tr>
            ))}
          </Table>
        )}

        <Pagination basePath="/admin/finance" params={{}} page={wallets.page} pageSize={wallets.pageSize} total={wallets.total} />
      </section>
    </div>
  );
}
