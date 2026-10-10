// app/(marketing)/_components/Cravings.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The appetite section: a swipeable rail of the things someone might
 * actually be picturing when they land here.
 *
 * `image` is optional on purpose. Drop a photo into
 * public/assets/cravings/<slug>.jpg and set it, and that card becomes
 * photographic; leave it off and the card falls back to its brand colour and
 * texture. Both states are designed — a missing photo never leaves a hole,
 * and the section can be filled in one dish at a time as real vendor
 * photography arrives.
 *
 * Photo provenance, so these can be re-sourced or replaced knowingly:
 *   rice-and-stews, swallow-and-soups  Pexels (#17952748, #37648017) —
 *                                      Pexels License, free for commercial
 *                                      use, no attribution required.
 *   the rest                           generated, pending real vendor shots.
 */
interface Craving {
  label: string;
  hint: string;
  /** Public path to a 4:5 photo, e.g. "/assets/cravings/rice-and-stews.jpg". */
  image?: string;
  /** Used when there is no photo yet. */
  tone: string;
  hintTone: string;
}

const CRAVINGS: readonly Craving[] = [
  {
    label: "Rice & stews",
    hint: "Jollof, fried rice, ofada",
    image: "/assets/cravings/rice-and-stews.jpg",
    tone: "bg-kk-red text-white",
    hintTone: "text-white/75",
  },
  {
    label: "Suya & grills",
    hint: "Straight off the coal",
    image: "/assets/cravings/suya-and-grills.jpg",
    tone: "bg-kk-ink text-white",
    hintTone: "text-white/65",
  },
  {
    label: "Swallow & soups",
    hint: "Egusi, afang, banga",
    image: "/assets/cravings/swallow-and-soups.jpg",
    tone: "bg-kk-orange text-white",
    hintTone: "text-white/80",
  },
  {
    label: "Shawarma & wraps",
    hint: "Late-night sorted",
    image: "/assets/cravings/shawarma-and-wraps.jpg",
    tone: "bg-kk-cocoa text-white",
    hintTone: "text-white/70",
  },
  {
    label: "Small chops",
    hint: "Puff-puff, samosa, meat pie",
    image: "/assets/cravings/small-chops.jpg",
    tone: "bg-kk-orange-deep text-white",
    hintTone: "text-white/75",
  },
  {
    label: "Groceries",
    hint: "The thing you forgot",
    image: "/assets/cravings/groceries.jpg",
    tone: "bg-kk-green text-white",
    hintTone: "text-white/75",
  },
] as const;

export function Cravings() {
  const railRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // Which arrows are live. Read straight off the node on scroll rather than
  // tracked as an index, so it stays correct however the rail was moved —
  // swipe, trackpad, or a link taking focus and scrolling itself into view.
  const measure = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const max = rail.scrollWidth - rail.clientWidth;
    setAtStart(rail.scrollLeft <= 8);
    setAtEnd(rail.scrollLeft >= max - 8);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const nudge = (direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    // Roughly one card plus its gap, so a click never leaves a sliver.
    rail.scrollBy({ left: direction * Math.min(rail.clientWidth * 0.8, 640), behavior: "smooth" });
  };

  return (
    <section
      id="cravings"
      className="relative scroll-mt-24 overflow-hidden bg-kk-cream py-20 sm:py-28"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="kk-blob -left-32 top-10 size-[460px] bg-kk-orange/25" />
        <div className="kk-blob -right-24 bottom-0 size-[420px] bg-kk-red/15" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red">
              <span className="h-px w-8 bg-kk-red/50" />
              On the menu
            </p>
            <h2 className="mt-5 font-sora text-[clamp(2rem,4.8vw,3.5rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-kk-ink">
              So — what are you
              <br className="hidden sm:block" /> actually craving?
            </h2>
            <p className="mt-5 max-w-lg font-inter text-lg leading-8 text-kk-cocoa">
              Whatever you just pictured, somebody a few streets away is already making it. Pick it,
              and it is on a bike before you have decided what to drink with it.
            </p>
          </div>

          {/* Arrows are an enhancement — the rail is swipeable on touch and
              tabbable everywhere, so they stay out of the a11y tree's way on
              small screens where there is no room for them. */}
          <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
            <RailButton label="Previous dishes" disabled={atStart} onClick={() => nudge(-1)}>
              <ChevronLeft className="size-5" />
            </RailButton>
            <RailButton label="More dishes" disabled={atEnd} onClick={() => nudge(1)}>
              <ChevronRight className="size-5" />
            </RailButton>
          </div>
        </div>
      </div>

      {/* Full-bleed rail: the first card lines up with the copy above, and the
          last one runs off the right edge so it reads as "there is more". */}
      <div
        ref={railRef}
        onScroll={measure}
        className="kk-rail relative mt-12 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:px-6 lg:px-[max(2rem,calc((100vw-80rem)/2+2rem))]"
      >
        {CRAVINGS.map((craving) => (
          <Link
            key={craving.label}
            href="/register"
            className="group relative aspect-[4/5] w-[218px] shrink-0 snap-start overflow-hidden rounded-[28px] shadow-[0_25px_50px_-30px_rgba(90,25,20,0.6)] transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_35px_70px_-30px_rgba(90,25,20,0.7)] sm:w-[248px]"
          >
            {craving.image ? (
              <Image
                src={craving.image}
                alt=""
                fill
                sizes="(max-width: 640px) 218px, 248px"
                className="object-cover transition-transform duration-700 group-hover:scale-110"
              />
            ) : (
              <span aria-hidden="true" className={`absolute inset-0 ${craving.tone}`}>
                <span className="kk-dots absolute inset-0 text-white/25" />
                <span className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10 transition-transform duration-700 group-hover:scale-125" />
              </span>
            )}

            {/* Scrim. Always on, so the label sits on the same footing whether
                the card is a photo or a colour block. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-kk-ink-deep/85 via-kk-ink-deep/20 to-transparent"
            />

            <span className="absolute inset-x-0 bottom-0 flex flex-col p-5 text-white">
              <span className="font-sora text-xl font-extrabold leading-tight tracking-tight">
                {craving.label}
              </span>
              <span className="mt-1 font-inter text-[13px] leading-5 text-white/70">
                {craving.hint}
              </span>
              <span className="mt-3 inline-flex items-center gap-1.5 font-inter text-[13px] font-semibold text-kk-mint opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                Order this
                <ArrowRight className="size-3.5" />
              </span>
            </span>
          </Link>
        ))}
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3 font-inter text-sm text-kk-cocoa">
          <span className="inline-flex items-center gap-2">
            <MapPin className="size-4 text-kk-red" />
            Only kitchens close enough to still be hot when they reach you
          </span>
          <span className="inline-flex items-center gap-2">
            <Clock className="size-4 text-kk-orange-deep" />
            Live opening hours, so nothing you tap is already shut
          </span>
        </div>
      </div>
    </section>
  );
}

function RailButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-full border border-kk-line bg-white/80 text-kk-ink backdrop-blur transition-all duration-300 hover:border-kk-red/40 hover:text-kk-red disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-kk-line disabled:hover:text-kk-ink"
    >
      {children}
    </button>
  );
}
