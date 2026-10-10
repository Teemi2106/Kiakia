import { formatNaira, type RecommendedItem } from "@kiakia/domain";
import { ArrowRight, Clock3, RotateCcw, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { RecommendationLink } from "./RecommendationLink";

export function PersonalizedSection({
  items,
  personalised,
}: {
  items: readonly RecommendedItem[];
  personalised: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section id="made-for-you" className="scroll-mt-40 rounded-[2rem] border border-kk-line/45 bg-white p-5 shadow-[0_25px_65px_-50px_rgba(66,29,20,0.5)] sm:p-7 lg:scroll-mt-24">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          {personalised ? (
            <>
              <p className="flex items-center gap-1.5 font-inter text-[10px] font-bold uppercase tracking-[0.22em] text-kk-red"><Sparkles className="size-3.5" /> Picked for you</p>
              <h2 className="mt-2 font-sora text-xl font-bold tracking-tight text-kk-ink sm:text-2xl">Recommended for you</h2>
              <p className="mt-1 font-inter text-xs text-kk-cocoa/75">Based on what you&apos;ve ordered and browsed.</p>
            </>
          ) : (
            <>
              <p className="font-inter text-[10px] font-bold uppercase tracking-[0.22em] text-kk-red">Near you</p>
              <h2 className="mt-2 font-sora text-xl font-bold tracking-tight text-kk-ink sm:text-2xl">Top rated near you</h2>
              <p className="mt-1 font-inter text-xs text-kk-cocoa/75">Open kitchens that deliver to your address.</p>
            </>
          )}
        </div>
        {personalised && <Link href="/orders/history" className="hidden items-center gap-1 font-inter text-xs font-bold text-kk-red hover:underline sm:flex">Order history <ArrowRight className="size-3.5" /></Link>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((dish) => (
          <RecommendationLink key={dish.menuItemId} href={`/vendors/${dish.vendorSlug}`} menuItemId={dish.menuItemId} className="group flex min-w-0 gap-3 rounded-2xl border border-kk-line/45 bg-kk-cream p-2.5 transition hover:-translate-y-0.5 hover:border-kk-orange/50 hover:shadow-lg">
            <div className="relative size-24 shrink-0 overflow-hidden rounded-xl bg-kk-sand">
              {dish.imageUrl ? <Image src={dish.imageUrl} alt="" fill sizes="96px" className="object-cover transition duration-500 group-hover:scale-105" /> : <span className="flex size-full items-center justify-center font-sora text-2xl font-bold text-kk-red/30">{dish.name.charAt(0)}</span>}
            </div>
            <div className="min-w-0 flex-1 py-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-kk-red-soft px-2 py-1 font-inter text-[9px] font-bold uppercase tracking-wide text-kk-red"><RotateCcw aria-hidden="true" className="size-3" /> {dish.reason}</span>
              <h3 className="mt-2 line-clamp-1 font-sora text-sm font-bold text-kk-ink group-hover:text-kk-red">{dish.name}</h3>
              <p className="mt-1 truncate font-inter text-[11px] text-kk-cocoa/75">{dish.vendorName}</p>
              <p className="mt-1 font-inter text-[11px] font-bold text-kk-ink">{formatNaira(dish.priceKobo)}</p>
              <p className="mt-2 flex items-center gap-1 font-inter text-[10px] font-semibold text-kk-cocoa"><Clock3 className="size-3" /> {dish.prepMins ? `~${dish.prepMins} min prep` : "Prep time varies"}</p>
            </div>
          </RecommendationLink>
        ))}
      </div>
    </section>
  );
}
