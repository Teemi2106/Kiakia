import { ArrowUpRight, Coins, Nfc, WalletCards } from "lucide-react";
import Link from "next/link";
import { formatNaira, koboOf } from "@kiakia/domain";

export function ProfileWalletCard({ balanceKobo, coins }: { balanceKobo: number; coins: number }) {
  return (
    <Link
      href="/profile/wallet"
      aria-label={`Open KiaKia wallet. Available balance ${formatNaira(koboOf(balanceKobo))}; ${coins.toLocaleString("en-NG")} KiaKia Coins.`}
      className="group relative block min-h-52 overflow-hidden rounded-[26px] border border-white/10 bg-[linear-gradient(135deg,#21140f_0%,#3a1b13_55%,#551e17_100%)] p-5 text-white shadow-[0_22px_45px_-28px_rgba(34,17,12,0.85)] transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none sm:p-6"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-16 size-52 rounded-full border border-white/10" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-9 size-40 rounded-full border border-white/10" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-12 size-48 rounded-full bg-kk-red/20 blur-2xl" />

      <span className="relative flex items-start justify-between gap-3">
        <span>
          <span className="block font-inter text-[10px] font-bold uppercase tracking-[0.22em] text-white/65">KiaKia</span>
          <span className="mt-0.5 block font-sora text-base font-semibold">Wallet</span>
        </span>
        <span className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#ffd8b9]">
          <WalletCards className="size-5" aria-hidden="true" />
        </span>
      </span>

      <span className="relative mt-6 flex items-center gap-2 text-white/65">
        <Nfc className="size-4" aria-hidden="true" />
        <span className="font-inter text-[10px] font-semibold uppercase tracking-[0.16em]">Available balance</span>
      </span>
      <span className="relative mt-1 block font-sora text-[28px] font-bold tracking-tight text-white sm:text-3xl">
        {formatNaira(koboOf(balanceKobo))}
      </span>

      <span className="relative mt-5 flex items-end justify-between gap-3 border-t border-white/15 pt-3">
        <span className="flex min-w-0 items-center gap-2 text-[#ffe1c7]">
          <Coins className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate font-inter text-xs font-semibold">{coins.toLocaleString("en-NG")} KiaKia Coins</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 font-inter text-xs font-semibold text-white transition-transform group-hover:translate-x-0.5">
          Open wallet <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}
