// app/(customer)/profile/wallet/page.tsx
import { formatNaira, koboOf } from "@kiakia/domain";
import { EmptyState } from "@kiakia/ui";
import { ArrowDownLeft, ArrowUpRight, Info, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

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

/**
 * The customer's own wallet. Both reads go through the argument-less RPCs
 * added by 0045_customer_wallet.sql, which answer only for auth.uid() —
 * `account_balances` itself stays revoked from `authenticated`
 * (0024_lock_down_account_balances_view.sql) because it exposes every
 * account on the platform.
 *
 * There is deliberately no "Add money" button: in this version a wallet is
 * funded only by a refunded order. Inventing a top-up entry point that goes
 * nowhere would be worse than the page being honest about where the balance
 * comes from.
 */
export default async function WalletPage() {
  await verifySession();
  const supabase = await createClient();

  const [{ data: balanceKobo }, { data: entries }] = await Promise.all([
    supabase.rpc("get_wallet_balance"),
    supabase.rpc("get_wallet_transactions", { p_limit: 50 }),
  ]);

  const balance = balanceKobo ?? 0;
  const rows = entries ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="font-sora text-[28px] font-bold text-[#1C1B1B] sm:text-[40px] sm:leading-[48px] sm:tracking-[-0.8px]">
        Wallet
      </h1>
      <p className="mt-2 font-inter text-sm text-[#5B403C] sm:text-base">
        Money from cancelled orders lands here instantly, and pays for your next one.
      </p>

      {/* Balance */}
      <div className="relative mt-6 overflow-hidden rounded-3xl bg-[#120D0C] p-6 text-white shadow-[0_30px_60px_-32px_rgba(18,13,12,0.9)] sm:p-8">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[#B61913]/25 blur-3xl"
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
              ? "Choose KiaKia Wallet at checkout to spend this. It covers the whole order or none of it — no part-payments yet."
              : "Nothing here yet. If an order is ever cancelled or rejected, its refund arrives here straight away."}
          </p>
        </div>
      </div>

      {/* Where the money can go — stated plainly, because "wallet credit" is
          exactly the kind of thing customers are right to be suspicious of. */}
      <div className="mt-4 flex gap-3 rounded-2xl border border-[#E4BEB8] bg-[#FCF9F8] p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-[#B61913]" />
        <p className="font-inter text-[13px] leading-5 text-[#5B403C]">
          Refunds come here by default because it&apos;s instant — a card refund takes days to
          settle. If you&apos;d rather have a refund back on the card you paid with,{" "}
          <Link href="/support" className="font-semibold text-[#B61913] underline underline-offset-2">
            contact support
          </Link>{" "}
          and we&apos;ll send it there instead.
        </p>
      </div>

      {/* History */}
      <h2 className="mt-10 font-sora text-xl font-semibold text-[#1C1B1B]">Activity</h2>

      {rows.length === 0 ? (
        <EmptyState
          className="mt-4 border-[#E4BEB8] bg-white"
          title="No wallet activity yet"
          description="Refunds and wallet payments will show up here."
        />
      ) : (
        <ul className="mt-4 divide-y divide-[#F0EDED] overflow-hidden rounded-2xl border border-[#E4BEB8] bg-white">
          {rows.map((row) => {
            const isCredit = row.direction === "credit";
            return (
              <li
                key={`${row.created_at}-${row.direction}-${row.amount_kobo}`}
                className="flex items-center gap-3 p-4"
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                    isCredit ? "bg-[#DFF3DC] text-[#176A22]" : "bg-[#FFDCC5] text-[#934B00]"
                  }`}
                >
                  {isCredit ? (
                    <ArrowDownLeft className="size-4" />
                  ) : (
                    <ArrowUpRight className="size-4" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-inter text-sm font-semibold text-[#1C1B1B]">
                    {isCredit ? "Refund received" : "Paid for order"}
                    {row.order_code ? ` · #${row.order_code}` : ""}
                  </span>
                  <span className="block font-inter text-xs text-[#5B403C]">
                    {formatWhen(row.created_at)}
                  </span>
                </span>

                <span
                  className={`shrink-0 font-sora text-sm font-bold ${
                    isCredit ? "text-[#176A22]" : "text-[#1C1B1B]"
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
    </div>
  );
}
