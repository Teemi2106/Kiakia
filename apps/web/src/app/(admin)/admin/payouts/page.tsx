import { listPayables, listPayoutHistory } from "@/lib/admin/finance";
import { listCustomerWalletWithdrawals } from "@/lib/admin/customer-wallet-withdrawals";
import { canManageFinance, requireAdminContext, requireFinanceContext } from "@/lib/auth/dal";
import { Badge, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { money } from "../../_components/format";
import { LinkTabs } from "../../_components/LinkTabs";
import { MarkAsPaid } from "../../_components/MarkAsPaid";
import { MaskedAccountNumber } from "../../_components/MaskedAccountNumber";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { PayoutHistory } from "../../_components/PayoutHistory";
import { CustomerWithdrawalReview } from "./_components/CustomerWithdrawalReview";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";

export const metadata: Metadata = { title: "Payouts" };

/** Each card carries a form, so a page is kept short. */
const TO_PAY_PAGE_SIZE = 10;
const CUSTOMER_WITHDRAWAL_PAGE_SIZE = 20;

export default async function AdminPayoutsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();
  const financeAccess = await canManageFinance();

  const raw = await searchParams;
  const requestedTab = firstParam(raw.tab);
  const tab = requestedTab === "history"
    ? "history"
    : requestedTab === "customer-withdrawals" && financeAccess
      ? "customer-withdrawals"
      : "to-pay";
  const page = pageParam(raw.page);

  // The To pay count shows on both tabs, so the list is read either way (one row is enough for the count).
  const [owed, history] = await Promise.all([
    listPayables(tab === "to-pay" ? { page, pageSize: TO_PAY_PAGE_SIZE } : { pageSize: 1 }),
    tab === "history" ? listPayoutHistory({ page }) : null,
  ]);
  const withdrawalSession = tab === "customer-withdrawals" ? await requireFinanceContext() : null;
  const customerWithdrawals = withdrawalSession
    ? await listCustomerWalletWithdrawals({ actorId: withdrawalSession.userId, page, pageSize: CUSTOMER_WITHDRAWAL_PAGE_SIZE })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader
        title="Payouts"
        description="Record completed vendor and rider transfers, or review customer wallet withdrawal requests. Customer requests remain reserved until rejected or recorded as paid after a transfer."
      />

      <LinkTabs
        label="Payouts"
        value={tab}
        items={[
          { value: "to-pay", label: "To pay", href: "/admin/payouts", count: owed.total },
          { value: "history", label: "History", href: "/admin/payouts?tab=history", count: history?.total },
          ...(financeAccess ? [{ value: "customer-withdrawals", label: "Customer withdrawals", href: "/admin/payouts?tab=customer-withdrawals" }] : []),
        ]}
      />

      {tab === "customer-withdrawals" && customerWithdrawals ? (
        customerWithdrawals.rows.length === 0 ? (
          <EmptyState title="No open customer requests" description="Customer wallet withdrawal requests awaiting review will appear here." />
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              {customerWithdrawals.total} open customer {customerWithdrawals.total === 1 ? "request" : "requests"}. Approval reserves the amount; only record a payout after the bank transfer is complete.
            </p>
            <ul className="flex flex-col gap-4">
              {customerWithdrawals.rows.map((row) => (
                <CustomerWithdrawalReview
                  key={row.id}
                  request={{
                    id: row.id,
                    customerName: row.customer_name,
                    amountKobo: row.amount_kobo,
                    bankName: row.bank_name,
                    accountName: row.account_name,
                    accountNumber: row.account_number,
                    maskedAccountNumber: row.masked_account_number,
                    status: row.status,
                    reviewReason: row.review_reason,
                    externalReference: row.external_reference,
                    createdAt: row.created_at,
                  }}
                />
              ))}
            </ul>
            <Pagination basePath="/admin/payouts" params={{ tab: "customer-withdrawals" }} page={page} pageSize={CUSTOMER_WITHDRAWAL_PAGE_SIZE} total={customerWithdrawals.total} />
          </>
        )
      ) : tab === "history" && history ? (
        <>
          <PayoutHistory payouts={history.rows} />
          <Pagination basePath="/admin/payouts" params={{ tab: "history" }} page={history.page} pageSize={history.pageSize} total={history.total} />
        </>
      ) : owed.rows.length === 0 ? (
        <EmptyState title="Nobody is waiting to be paid" description="Every vendor and rider has been paid what they are owed." />
      ) : (
        <>
          <p className="text-sm text-ink">
            <strong>{money(owed.totalOwedKobo)}</strong> is owed to {owed.total} {owed.total === 1 ? "person" : "people"}, largest amount first.
          </p>
          <ul className="flex flex-col gap-4">
            {owed.rows.map((payable) => {
              const name = payable.displayName ?? "this " + payable.ownerType;
              const href = `/admin/${payable.ownerType === "vendor" ? "vendors" : "riders"}/${payable.ownerId}`;
              return (
                <li key={`${payable.ownerType}:${payable.ownerId}`} className="rounded-card border border-border bg-surface-raised p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={href} className="font-medium text-brand-600 hover:underline">
                        {name}
                      </Link>
                      <Badge className="ml-2">{payable.ownerType === "vendor" ? "Vendor" : "Rider"}</Badge>
                      <p className="mt-1 text-sm text-ink-muted">
                        {payable.bank ? (
                          <>
                            {payable.bank.bankName} · {payable.bank.accountName} · <MaskedAccountNumber masked={payable.bank.maskedNumber} />
                            {financeAccess && (
                              <>
                                {" "}
                                <Link href={href} className="text-brand-600 hover:underline">
                                  Open to see the full number
                                </Link>
                              </>
                            )}
                          </>
                        ) : payable.ownerType === "vendor" ? (
                          "Bank details not on file"
                        ) : (
                          "This rider has not added bank details"
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wide text-ink-muted">Amount owed</p>
                      <p className="text-xl font-semibold text-ink">{money(payable.balanceKobo)}</p>
                      <p className="text-xs text-ink-muted">Paid so far {money(payable.disbursedKobo)}</p>
                    </div>
                  </div>
                  <div className="mt-4 border-t border-border pt-4">
                    <MarkAsPaid
                      ownerType={payable.ownerType}
                      ownerId={payable.ownerId}
                      ownerName={name}
                      owedKobo={payable.balanceKobo}
                      canRecord={financeAccess}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination basePath="/admin/payouts" params={{}} page={owed.page} pageSize={owed.pageSize} total={owed.total} />
        </>
      )}
    </div>
  );
}
