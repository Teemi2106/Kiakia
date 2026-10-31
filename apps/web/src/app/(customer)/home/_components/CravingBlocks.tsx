import { Banknote, Flame, MapPin, Sparkles, Timer, Utensils } from "lucide-react";
import Link from "next/link";

const CRAVINGS = [
  { label: "Something filling", detail: "Big comfort, zero compromise", href: "/home?category=swallow_soup_combos", icon: Utensils, tone: "from-[#4d160f] to-[#9b2719]" },
  { label: "Something fast", detail: "Quick prep for busy moments", href: "/home?quick=1&open=1", icon: Timer, tone: "from-[#d64618] to-[#ff8a24]" },
  { label: "Local favourites", detail: "The flavours that feel like home", href: "/home?category=swallow", icon: MapPin, tone: "from-[#173f2a] to-[#397c50]" },
  { label: "Budget-friendly", detail: "Great taste, easy on your wallet", href: "/home?sort=rating", icon: Banknote, tone: "from-[#302318] to-[#765437]" },
] as const;

export function CravingBlocks() {
  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div><p className="flex items-center gap-1.5 font-inter text-[10px] font-bold uppercase tracking-[0.22em] text-kk-red"><Sparkles className="size-3.5" /> Tell us the mood</p><h2 className="mt-2 font-sora text-xl font-bold tracking-tight text-kk-ink sm:text-2xl">What would hit the spot?</h2></div>
        <Flame className="size-6 text-kk-orange" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CRAVINGS.map(({ label, detail, href, icon: Icon, tone }) => (
          <Link key={label} href={href} className={`group relative min-h-36 overflow-hidden rounded-3xl bg-gradient-to-br ${tone} p-4 text-white transition duration-300 hover:-translate-y-1 hover:shadow-xl sm:min-h-40 sm:p-5`}>
            <span aria-hidden="true" className="absolute -bottom-10 -right-8 size-28 rounded-full border-[18px] border-white/10 transition duration-500 group-hover:scale-125" />
            <Icon className="size-6 text-white/80" />
            <h3 className="mt-7 font-sora text-[15px] font-bold leading-tight sm:text-lg">{label}</h3>
            <p className="mt-1 hidden font-inter text-[11px] leading-4 text-white/65 sm:block">{detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
