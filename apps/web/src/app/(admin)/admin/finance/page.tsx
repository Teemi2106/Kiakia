import { getLedgerHealth, listBalances, type BalanceOwnerType } from "@/lib/admin/finance";
import { canManageFinance, requireAdminContext } from "@/lib/auth/dal";
import { EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { money } from "../../_components/format";
import { MaskedAccountNumber } from "../../_components/MaskedAccountNumber";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";
import { Table, Td, Th, Tr } from "../../_components/Table";
import { BalanceTabs } from "./_components/BalanceTabs";
import { LedgerHealthPanel } from "./_components/LedgerHealthPanel";
import { PayoutForm } from "./_components/PayoutForm";

export const metadata: Metadata = { title: "Finance" };

const OWNER_TYPES: readonly BalanceOwnerType[] = ["vendor", "rider", "customer"];

export default async function AdminFinancePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();
  const financeAccess = await canManageFinance();

  const raw = await searchParams;
  const requested = firstParam(raw.tab);
  const tab = OWNER_TYPES.find((type) => type === requested) ?? "vendor";

  const [health, balances] = await Promise.all([getLedgerHealth(), listBalances(tab, { page: pageParam(raw.page) })]);
  const payoutOwner = tab === "vendor" || tab === "rider" ? tab : null;
  const canPayOut = payoutOwner !== null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader title="Finance" description="Ledger integrity and what the platform owes vendors and riders." />

      <LedgerHealthPanel health={health} />

      <section className="flex flex-col gap-4">
        <BalanceTabs value={tab} />

        {canPayOut && (
          <p className="text-sm text-ink-muted">
            Recording a payout books a bank transfer that has already been made; it does not send money.
            {!financeAccess && " Recording payouts needs finance access."}
          </p>
        )}

        {balances.rows.length === 0 ? (
          <EmptyState title="No balances yet" description="Nobody in this group has a ledger account yet." />
        ) : (
          <Table
            head={
              <>
                <Th>{tab === "customer" ? "Customer" : tab === "vendor" ? "Vendor" : "Rider"}</Th>
                <Th className="text-right">{tab === "customer" ? "Wallet" : "Available"}</Th>
                {canPayOut && <Th className="text-right">Paid out</Th>}
                {tab === "rider" && <Th>Bank</Th>}
                {canPayOut && <Th>Payout</Th>}
              </>
            }
          >
            {balances.rows.map((row) => (
              <Tr key={row.ownerId}>
                <Td>
                  <Link href={`/admin/${tab === "vendor" ? "vendors" : tab === "rider" ? "riders" : "users"}/${row.ownerId}`} className="font-medium text-brand-600 hover:underline">
                    {row.displayName ?? row.ownerId}
                  </Link>
                </Td>
                <Td className="text-right">{money(row.balanceKobo)}</Td>
                {canPayOut && <Td className="text-right">{money(row.disbursedKobo)}</Td>}
                {tab === "rider" && (
                  <Td>
                    {row.bank ? (
                      <div className="text-xs">
                        <p>
                          {row.bank.bankName} · {row.bank.accountName}
                        </p>
                        <MaskedAccountNumber masked={row.bank.maskedNumber} />
                      </div>
                    ) : (
                      <span className="text-ink-muted">Not provided</span>
                    )}
                  </Td>
                )}
                {canPayOut && (
                  <Td className="min-w-72">
                    {!financeAccess ? (
                      <span className="text-ink-muted">Finance access required</span>
                    ) : payoutOwner && row.balanceKobo > 0 ? (
                      <details>
                        <summary className="cursor-pointer text-sm text-brand-600">Record payout</summary>
                        <div className="pt-3">
                          <PayoutForm ownerType={payoutOwner} ownerId={row.ownerId} />
                        </div>
                      </details>
                    ) : (
                      <span className="text-ink-muted">Nothing to pay</span>
                    )}
                  </Td>
                )}
              </Tr>
            ))}
          </Table>
        )}

        <Pagination
          basePath="/admin/finance"
          params={{ tab }}
          page={balances.page}
          pageSize={balances.pageSize}
          total={balances.total}
        />
      </section>
    </div>
  );
}
