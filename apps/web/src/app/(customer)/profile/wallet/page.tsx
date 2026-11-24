// app/(customer)/profile/wallet/page.tsx
import { formatNaira, koboOf } from "@kiakia/domain";
import { EmptyState } from "@kiakia/ui";
import { ArrowDownLeft, ArrowUpRight, Info, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTransaction } from "@/lib/monnify";
import { WalletTopUpForm } from "./_components/WalletTopUpForm";
import type { Json } from "@kiakia/db";

export const metadata: Metadata = { title: "Wallet" };

function formatWhen(value: string): string {
  return new Date(value).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type WalletPageProps = {
  searchParams: Promise<{ topup?: string | string[] }>;
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
  let topupNotice: { text: string; success: boolean } | null = null;

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
          (verified.paymentStatus === "PAID" || verified.paymentStatus === "OVERPAID") &&
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
            ? { text: "Your payment is being confirmed. Refresh this page in a moment.", success: false }
            : { text: "Your wallet has been funded.", success: true };
        } else {
          topupNotice = { text: "We haven't received confirmation yet. If you just paid, refresh this page in a moment.", success: false };
        }
      } catch (error) {
        console.error("Monnify wallet top-up return verification failed", error);
        topupNotice = { text: "Your payment is being confirmed. Refresh this page in a moment.", success: false };
      }
    } else if (topup?.status === "failed") {
      topupNotice = { text: "The payment could not be prepared. Your wallet was not charged; please try again.", success: false };
    }
  }

  const supabase = await createClient();

  const [{ data: balanceKobo }, { data: entries }, { data: coinBalance }, { data: coinEntries }, { data: cashbackBps }] = await Promise.all([
    supabase.rpc("get_wallet_balance"),
    supabase.rpc("get_wallet_transactions", { p_limit: 50 }),
    supabase.rpc("get_kiakia_coin_balance"),
    supabase.rpc("get_kiakia_coin_transactions", { p_limit: 50 }),
    supabase.rpc("get_cashback_bps"),
  ]);

  const balance = balanceKobo ?? 0;
  const rows = entries ?? [];
  const coins = coinBalance ?? 0;
  const coinRows = coinEntries ?? [];
  const cashbackRate = typeof cashbackBps === "number"
    ? `${(cashbackBps / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}%`
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-sora text-[28px] font-bold text-kk-ink sm:text-[40px] sm:leading-[48px] sm:tracking-[-0.8px]">
        Wallet
      </h1>
      <p className="mt-2 font-inter text-sm text-kk-cocoa sm:text-base">
        Add money securely, or use refunds from cancelled orders to pay for your next one.
      </p>

      {topupNotice && (
        <p
          role="status"
          className={`mt-5 rounded-xl border px-4 py-3 font-inter text-sm ${
            topupNotice.success
              ? "border-[#B9E3B4] bg-[#DFF3DC] text-kk-green-ink-ink"
              : "border-kk-line bg-kk-cream text-kk-cocoa"
          }`}
        >
          {topupNotice.text}
        </p>
      )}

      {/* Balance */}
      <div className="relative mt-6 overflow-hidden rounded-3xl bg-[#120D0C] p-6 text-white shadow-[0_30px_60px_-32px_rgba(18,13,12,0.9)] sm:p-8">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-kk-red/25 blur-3xl"
        />
        <div className="relative">
          <span className="flex items-center gap-2 font-inter text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
            <Wallet className="size-3.5" />
            Available balance
          </span>
          <p className="mt-3 font-sora text-4xl font-extrabold tracking-tight sm:text-5xl">
            {formatNaira(koboOf(balance))}
          </p>
          <p className="mt-4 max-w-md font-inter text-sm text-white/55">
            {balance > 0
              ? "Use it at checkout. It can pay for a whole order, or you can put it towards an order and pay the rest by card."
              : "Add money to your wallet, or any refund from a cancelled or rejected order will arrive here."}
          </p>
        </div>
      </div>

      <WalletTopUpForm />

      <div className="mt-4 flex gap-3 rounded-2xl border border-kk-line bg-kk-cream p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-kk-red-ink" />
        <p className="font-inter text-[13px] leading-5 text-kk-cocoa">
          Refunds arrive here instantly. If you&apos;d rather have a refund back on the card you paid with,{" "}
          <Link href="/support" className="font-semibold text-kk-red-ink underline underline-offset-2">
            contact support
          </Link>{" "}
          and we&apos;ll send it there instead.
        </p>
      </div>

      {/* History */}
      <h2 className="mt-10 font-sora text-xl font-semibold text-kk-ink">Activity</h2>

      {rows.length === 0 ? (
        <EmptyState
          className="mt-4 border-kk-line bg-kk-card"
          title="No wallet activity yet"
          description="Refunds and wallet payments will show up here."
        />
      ) : (
        <ul className="mt-4 divide-y divide-kk-fill overflow-hidden rounded-2xl border border-kk-line bg-kk-card">
          {rows.map((row) => {
            const isCredit = row.direction === "credit";
            return (
              <li
                key={`${row.created_at}-${row.direction}-${row.amount_kobo}`}
                className="flex items-center gap-3 p-4"
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                    isCredit ? "bg-[#DFF3DC] text-kk-green-ink-ink" : "bg-notice-surface text-kk-orange-ink"
                  }`}
                >
                  {isCredit ? (
                    <ArrowDownLeft className="size-4" />
                  ) : (
                    <ArrowUpRight className="size-4" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-inter text-sm font-semibold text-kk-ink">
                    {walletRowLabel(row.entry_type, isCredit)}
                    {row.order_code ? ` · #${row.order_code}` : ""}
                  </span>
                  <span className="block font-inter text-xs text-kk-cocoa">
                    {formatWhen(row.created_at)}
                  </span>
                </span>

                <span
                  className={`shrink-0 font-sora text-sm font-bold ${
                    isCredit ? "text-kk-green-ink-ink" : "text-kk-ink"
                  }`}
                >
                  {isCredit ? "+" : "−"}
                  {formatNaira(koboOf(row.amount_kobo))}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-10 rounded-3xl border border-kk-line bg-kk-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-sora text-xl font-semibold text-kk-ink">KiaKia Coins</h2>
            <p className="mt-1 font-inter text-sm text-kk-cocoa">
              Earned after your order is delivered{cashbackRate ? ` at ${cashbackRate} of eligible food spend` : ""}.
            </p>
          </div>
          <div className="text-right">
            <p className="font-sora text-2xl font-bold text-kk-ink">{coins.toLocaleString("en-NG")} coins</p>
            <p className="mt-1 font-inter text-sm text-kk-cocoa">Worth {formatNaira(koboOf(coins * 10))}</p>
          </div>
        </div>
        <p className="mt-4 rounded-xl bg-kk-cream px-4 py-3 font-inter text-sm text-kk-cocoa">
          10 KiaKia Coins = ₦1. Cashback is up to 0.5% of food spend after discounts, excluding delivery and service fees, and capped at ₦500 (5,000 coins) per order.
        </p>
      </section>

      <h2 className="mt-10 font-sora text-xl font-semibold text-kk-ink">KiaKia Coins activity</h2>
      {coinRows.length === 0 ? (
        <EmptyState
          className="mt-4 border-kk-line bg-kk-card"
          title="No coins yet"
          description="Coins from completed orders will show up here."
        />
      ) : (
        <ul className="mt-4 divide-y divide-kk-fill overflow-hidden rounded-2xl border border-kk-line bg-kk-card">
          {coinRows.map((row) => (
            <li key={row.order_id} className="flex items-center gap-3 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#DFF3DC] font-sora text-sm font-bold text-kk-green-ink-ink">K</span>
              <span className="min-w-0 flex-1">
                <span className="block font-inter text-sm font-semibold text-kk-ink">
                  Order cashback{row.order_code ? ` · #${row.order_code}` : ""}
                </span>
                <span className="block font-inter text-xs text-kk-cocoa">{formatWhen(row.created_at)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-sora text-sm font-bold text-kk-green-ink-ink">+{row.coins.toLocaleString("en-NG")} coins</span>
                <span className="block font-inter text-xs text-kk-cocoa">{formatNaira(koboOf(row.coins * 10))}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What a wallet ledger row is, in the customer's words. */
function walletRowLabel(entryType: string, isCredit: boolean): string {
  if (entryType === "wallet_topup") return "Wallet funded";
  if (entryType === "wallet_hold") return "Set aside for an order";
  if (entryType === "wallet_hold_release") return "Returned, order was not paid";
  return isCredit ? "Refund received" : "Paid for order";
}
