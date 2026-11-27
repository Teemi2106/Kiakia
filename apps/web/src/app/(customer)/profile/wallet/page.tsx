// app/(customer)/profile/wallet/page.tsx
import { formatNaira, koboOf } from "@kiakia/domain";
import { EmptyState } from "@kiakia/ui";
import { ArrowDownLeft, ArrowUpRight, Info, Wifi } from "lucide-react";
import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTransaction } from "@/lib/monnify";
import { WalletTopUpForm } from "./_components/WalletTopUpForm";
import { WalletWithdrawalForm } from "./_components/WalletWithdrawalForm";
import { CancelWithdrawalButton } from "./_components/CancelWithdrawalButton";
import { WalletTabs } from "./_components/WalletTabs";
import type { Json } from "@kiakia/db";

export const metadata: Metadata = { title: "Wallet" };

const TZ = "Africa/Lagos";

function formatWhen(value: string): string {
  return new Date(value).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

function dayKey(value: string): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: TZ });
}

function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const diff = Math.round((Date.parse(today) - Date.parse(key)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  });
}

/** Groups rows (already newest first) under a heading per day. */
function groupByDay<T extends { created_at: string }>(items: T[]) {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: dayLabel(key), items: [item] });
    }
  }
  return groups;
}

type WalletPageProps = {
  searchParams: Promise<{
    topup?: string | string[];
    withdrawal?: string | string[];
  }>;
};

/**
 * The wallet balance and both activity feeds are scoped to auth.uid() by
 * their RPCs. A Monnify return is only a prompt to re-check payment status;
 * the wallet is credited by the same service-role RPC used by the webhook.
 */
export default async function WalletPage({ searchParams }: WalletPageProps) {
  const session = await verifySession();
  const query = await searchParams;
  const topupReference = typeof query.topup === "string" ? query.topup : null;
  const withdrawalNoticeParam =
    typeof query.withdrawal === "string" ? query.withdrawal : null;
  let topupNotice: { text: string; success: boolean } | null = null;

  if (withdrawalNoticeParam === "requested") {
    topupNotice = {
      text: "Your withdrawal request was submitted and is pending review. The requested amount is reserved until the request is cancelled, declined, or paid.",
      success: true,
    };
  } else if (withdrawalNoticeParam === "cancelled") {
    topupNotice = {
      text: "Your pending withdrawal request was cancelled and its reserved amount is available again.",
      success: true,
    };
  }

  if (topupReference && /^KKW-[A-F0-9]{32}$/.test(topupReference)) {
    const admin = createAdminClient();
    const { data: topup } = await admin
      .from("wallet_topups")
      .select("reference, customer_id, provider_ref, status")
      .eq("reference", topupReference)
      .eq("customer_id", session.userId)
      .maybeSingle();

    if (topup?.status === "success") {
      topupNotice = { text: "Your wallet has been funded.", success: true };
    } else if (topup?.status === "pending" && topup.provider_ref) {
      try {
        const verified = await verifyTransaction(topup.provider_ref);
        if (
          (verified.paymentStatus === "PAID" ||
            verified.paymentStatus === "OVERPAID") &&
          verified.paymentReference === topup.reference &&
          verified.transactionReference === topup.provider_ref &&
          verified.currency === "NGN" &&
          Number.isFinite(verified.amountPaid) &&
          verified.amountPaid > 0
        ) {
          const { error } = await admin.rpc("capture_wallet_topup", {
            p_reference: topup.reference,
            p_provider_ref: verified.transactionReference,
            p_amount_kobo: Math.round(verified.amountPaid * 100),
            p_raw: verified as unknown as Json,
          });
          topupNotice = error
            ? {
                text: "Your payment is being confirmed. Refresh this page in a moment.",
                success: false,
              }
            : { text: "Your wallet has been funded.", success: true };
        } else {
          topupNotice = {
            text: "We haven't received confirmation yet. If you just paid, refresh this page in a moment.",
            success: false,
          };
        }
      } catch (error) {
        console.error(
          "Monnify wallet top-up return verification failed",
          error,
        );
        topupNotice = {
          text: "Your payment is being confirmed. Refresh this page in a moment.",
          success: false,
        };
      }
    } else if (topup?.status === "failed") {
      topupNotice = {
        text: "The payment could not be prepared. Your wallet was not charged; please try again.",
        success: false,
      };
    }
  }

  const supabase = await createClient();

  const [
    { data: balanceKobo },
    { data: reservedKobo },
    { data: entries },
    { data: coinBalance },
    { data: coinEntries },
    { data: withdrawalRequests },
  ] = await Promise.all([
    supabase.rpc("get_wallet_balance"),
    supabase.rpc("get_wallet_reserved_balance"),
    supabase.rpc("get_wallet_transactions", { p_limit: 50 }),
    supabase.rpc("get_kiakia_coin_balance"),
    supabase.rpc("get_kiakia_coin_transactions", { p_limit: 50 }),
    supabase.rpc("get_my_wallet_withdrawal_requests"),
  ]);

  const balance = balanceKobo ?? 0;
  const reserved = reservedKobo ?? 0;
  const rows = entries ?? [];
  const withdrawalRows = withdrawalRequests ?? [];
  const coins = coinBalance ?? 0;
  const coinRows = coinEntries ?? [];
  const pendingCount = withdrawalRows.filter(
    (request) => request.status === "pending",
  ).length;

  const activityPanel =
    rows.length === 0 ? (
      <EmptyState
        className="border-kk-line bg-kk-card"
        title="No wallet activity yet"
        description="Refunds and wallet payments will show up here."
      />
    ) : (
      <div className="space-y-6">
        {groupByDay(rows).map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h3 className="px-1 font-inter text-sm font-semibold text-kk-cocoa">
              {group.label}
            </h3>
            <ul className="mt-2 divide-y divide-kk-fill overflow-hidden rounded-2xl border border-kk-line bg-kk-card">
              {group.items.map((row, index) => {
                const isCredit = row.direction === "credit";
                return (
                  <li
                    key={`${row.created_at}-${row.direction}-${row.amount_kobo}-${index}`}
                    className="flex items-center gap-3 px-4 py-3.5"
                  >
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                        isCredit
                          ? "bg-kk-green-wash text-kk-green-ink"
                          : "bg-notice-surface text-kk-orange-ink"
                      }`}
                    >
                      {isCredit ? (
                        <ArrowDownLeft className="size-4" />
                      ) : (
                        <ArrowUpRight className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-inter text-sm font-semibold text-kk-ink">
                        {walletRowLabel(row.entry_type, isCredit)}
                      </span>
                      <span className="block font-inter text-xs text-kk-cocoa">
                        {formatTime(row.created_at)}
                        {row.order_code ? ` · Order #${row.order_code}` : ""}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-sora text-sm font-bold tabular-nums ${
                        isCredit ? "text-kk-green-ink" : "text-kk-ink"
                      }`}
                    >
                      {isCredit ? "+" : "−"}
                      {formatNaira(koboOf(row.amount_kobo))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );

  const withdrawalsPanel =
    withdrawalRows.length === 0 ? (
      <EmptyState
        className="border-kk-line bg-kk-card"
        title="No withdrawal requests"
        description="Requests you submit will appear here with their review status."
      />
    ) : (
      <ul className="space-y-3">
        {withdrawalRows.map((request) => (
          <li
            key={request.id}
            className="rounded-2xl border border-kk-line bg-kk-card p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-sora text-xl font-bold tabular-nums text-kk-ink">
                {formatNaira(koboOf(request.amount_kobo))}
              </p>
              <span
                className={`shrink-0 rounded-full px-3 py-1 font-inter text-xs font-semibold ${withdrawalStatusTone(request.status)}`}
              >
                {withdrawalStatusLabel(request.status)}
              </span>
            </div>
            <p className="mt-2 font-inter text-sm font-medium text-kk-ink">
              {request.bank_name} · {request.account_name}
            </p>
            <p className="font-inter text-xs text-kk-cocoa">
              Account ending {request.masked_account_number.slice(-4)} ·{" "}
              {formatWhen(request.created_at)}
            </p>
            {request.review_reason && (
              <p className="mt-3 rounded-xl bg-kk-fill px-3 py-2 font-inter text-sm text-kk-cocoa">
                Review note: {request.review_reason}
              </p>
            )}
            {request.status === "pending" && (
              <div className="mt-3">
                <CancelWithdrawalButton requestId={request.id} />
              </div>
            )}
          </li>
        ))}
      </ul>
    );

  const coinsPanel =
    coinRows.length === 0 ? (
      <EmptyState
        className="border-kk-line bg-kk-card"
        title="No coins yet"
        description="Coins from completed orders will show up here."
      />
    ) : (
      <ul className="divide-y divide-kk-fill overflow-hidden rounded-2xl border border-kk-line bg-kk-card">
        {coinRows.map((row) => (
          <li
            key={row.order_id}
            className="flex items-center gap-3 px-4 py-3.5"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-kk-green-wash font-sora text-sm font-bold text-kk-green-ink">
              K
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-inter text-sm font-semibold text-kk-ink">
                Order cashback
                {row.order_code ? ` · #${row.order_code}` : ""}
              </span>
              <span className="block font-inter text-xs text-kk-cocoa">
                {formatWhen(row.created_at)}
              </span>
            </span>
            <span className="shrink-0 font-sora text-sm font-bold tabular-nums text-kk-green-ink">
              +{row.coins.toLocaleString("en-NG")} coins
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      <header>
        <h1 className="font-sora text-[28px] font-bold text-kk-ink sm:text-[40px] sm:leading-[48px] sm:tracking-[-0.8px]">
          Wallet
        </h1>
        <p className="mt-2 max-w-xl font-inter text-sm text-kk-cocoa sm:text-base">
          Add money, pay with it at checkout, or ask to withdraw it.
        </p>
      </header>

      {topupNotice && (
        <p
          role="status"
          className={`mt-5 rounded-xl border px-4 py-3 font-inter text-sm ${
            topupNotice.success
              ? "border-kk-green-ink/25 bg-kk-green-wash text-kk-green-ink"
              : "border-kk-danger-ink/25 bg-kk-danger-wash text-kk-danger-ink"
          }`}
        >
          {topupNotice.text}
        </p>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-start md:gap-8">
        {/* Left column: balance, coins, money in and out */}
        <div className="space-y-5">
          <section aria-label="Balance">
            <div className="relative isolate mx-auto flex aspect-[1.586/1] min-h-[13.5rem] w-full max-w-[24rem] flex-col md:mx-0 justify-between overflow-hidden rounded-[22px] bg-gradient-to-br from-kk-red to-[#5c0c09] p-5 text-white shadow-xl ring-1 ring-white/10 sm:p-6">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-12 -top-28 -z-10 size-72 rounded-full border border-white/15"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-2 -top-16 -z-10 size-48 rounded-full border border-white/15"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-tr from-transparent via-white/10 to-transparent"
              />

              <div className="flex items-start justify-between">
                <p className="font-sora text-lg font-extrabold tracking-tight">
                  KiaKia
                </p>
                <Wifi
                  className="size-6 rotate-90 text-white/80"
                  aria-hidden="true"
                />
              </div>

              {/* Card chip */}
              <span
                aria-hidden="true"
                className="relative block h-8 w-11 overflow-hidden rounded-md bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500 ring-1 ring-amber-700/40"
              >
                <span className="absolute inset-x-0 top-1/3 h-px bg-amber-700/40" />
                <span className="absolute inset-x-0 top-2/3 h-px bg-amber-700/40" />
                <span className="absolute inset-y-0 left-1/3 w-px bg-amber-700/40" />
                <span className="absolute inset-y-0 left-2/3 w-px bg-amber-700/40" />
              </span>

              <div>
                <p className="font-inter text-xs font-medium text-white/75">
                  Available balance
                </p>
                <p className="mt-1 font-sora text-[34px] font-extrabold leading-none tracking-tight tabular-nums sm:text-4xl">
                  {formatNaira(koboOf(balance))}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="font-inter text-xs font-semibold tracking-wide text-white/75">
                  Wallet
                </p>
                <p className="flex items-center gap-2 font-sora text-sm font-bold tabular-nums">
                  <span className="flex size-6 items-center justify-center rounded-full bg-white font-sora text-[11px] font-extrabold text-kk-red-ink">
                    K
                  </span>
                  {coins.toLocaleString("en-NG")} coins
                </p>
              </div>
            </div>

            <p className="mt-3 px-1 font-inter text-sm text-kk-cocoa">
              {balance > 0
                ? "Ready to use at checkout."
                : "Add money below. Refunds from cancelled or rejected orders land here too."}{" "}
              Cashback comes as coins after delivery. Order. Enjoy. Earn! 🪙
            </p>
            {reserved > 0 && (
              <p className="mt-2 inline-flex rounded-full bg-kk-fill px-3 py-1.5 font-inter text-xs font-semibold text-kk-cocoa">
                {formatNaira(koboOf(reserved))} held for withdrawal requests
              </p>
            )}
          </section>

          <WalletTopUpForm />

          <WalletWithdrawalForm
            availableKobo={balance}
            requestKey={randomUUID()}
          />

          <div className="flex gap-3 rounded-2xl bg-kk-cream p-4">
            <Info className="mt-0.5 size-4 shrink-0 text-kk-red-ink" />
            <p className="font-inter text-[13px] leading-5 text-kk-cocoa">
              Refunds arrive here instantly. Withdrawals are reviewed by hand
              and are not paid when you submit them. If you&apos;d rather have a
              refund back on the card you paid with,{" "}
              <Link
                href="/support"
                className="font-semibold text-kk-red-ink underline underline-offset-2"
              >
                contact support
              </Link>{" "}
              and we&apos;ll send it there instead.
            </p>
          </div>
        </div>

        {/* Right column: everything that has happened */}
        <WalletTabs
          tabs={[
            { id: "activity", label: "Activity", panel: activityPanel },
            {
              id: "withdrawals",
              label: "Withdrawals",
              badge: pendingCount,
              panel: withdrawalsPanel,
            },
            { id: "coins", label: "Coins", panel: coinsPanel },
          ]}
        />
      </div>
    </div>
  );
}

/** What a wallet ledger row is, in the customer's words. */
function walletRowLabel(entryType: string, isCredit: boolean): string {
  if (entryType === "wallet_topup") return "Wallet funded";
  if (entryType === "wallet_hold") return "Set aside for an order";
  if (entryType === "wallet_hold_release")
    return "Returned, order was not paid";
  if (entryType === "payout") return "Wallet withdrawal";
  return isCredit ? "Refund received" : "Paid for order";
}

function withdrawalStatusLabel(status: string): string {
  if (status === "pending") return "Pending review";
  if (status === "approved") return "Approved · awaiting transfer";
  if (status === "paid") return "Paid";
  if (status === "rejected") return "Declined";
  if (status === "cancelled") return "Cancelled";
  return "Processing";
}

function withdrawalStatusTone(status: string): string {
  if (status === "pending") return "bg-notice-surface text-kk-orange-ink";
  if (status === "approved" || status === "paid")
    return "bg-kk-green-wash text-kk-green-ink";
  if (status === "rejected") return "bg-kk-danger-wash text-kk-danger-ink";
  return "bg-kk-fill text-kk-cocoa";
}
