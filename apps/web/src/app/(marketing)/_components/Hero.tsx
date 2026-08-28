// app/(marketing)/_components/Hero.tsx
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Bike, Lock, Store } from "lucide-react";

/**
 * The noun that cycles as the first line of the headline. SIZER is whichever
 * of them is widest — it is rendered invisibly to hold the inline box open,
 * so nothing after the rotator reflows as the words change. The stagger is
 * one fifth of the 11s cycle in marketing.css, so exactly one word is up at
 * any moment.
 */
const CRAVINGS = ["Jollof", "Suya", "Shawarma", "Swallow", "Groceries"] as const;
const SIZER = "Groceries";
const WORD_STAGGER_MS = 11_000 / CRAVINGS.length;

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-kk-cream pb-20 pt-6 sm:pb-28 sm:pt-10">
      {/* Ambient wash. Purely decorative, so it stays out of the a11y tree. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="kk-blob -left-40 -top-52 size-[560px] bg-kk-red/25" />
        <div className="kk-blob -right-32 top-10 size-[520px] bg-kk-orange/30" />
        <div className="kk-blob left-1/3 top-[60%] size-[420px] bg-kk-mint/40" />
        <div className="kk-dots absolute inset-0 text-kk-cocoa/20" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-kk-cream" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:px-8">
        {/* ------------------------------------------------------ copy */}
        <div className="max-w-2xl">
          <p
            className="kk-enter flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red"
            style={{ "--kk-delay": "40ms" } as React.CSSProperties}
          >
            <span className="h-px w-8 bg-kk-red/50" />
            Fast. Fresh. Reliable.
          </p>

          <h1
            className="kk-enter mt-6 font-sora font-extrabold leading-[0.9] tracking-[-0.04em] text-kk-ink"
            style={{ "--kk-delay": "120ms" } as React.CSSProperties}
          >
            <span className="block text-[clamp(3rem,12.5vw,5.5rem)]">
              <span className="kk-rotator text-kk-red">
                {/* Holds the width of the widest word; never actually seen. */}
                <span className="kk-rotator-sizer" aria-hidden="true">
                  {SIZER}
                </span>
                <span className="kk-rotator-viewport" aria-hidden="true">
                  {CRAVINGS.map((word, i) => (
                    <span
                      key={word}
                      className="kk-rotator-word"
                      style={{ "--kk-delay": `${Math.round(i * WORD_STAGGER_MS)}ms` } as React.CSSProperties}
                    >
                      {word}
                    </span>
                  ))}
                </span>
                {/* What the headline reads as, for screen readers and crawlers. */}
                <span className="sr-only">Food</span>
              </span>
            </span>

            <span className="mt-3 block text-[clamp(1.85rem,7.2vw,3.25rem)] leading-[1.02]">
              at your door,{" "}
              <span className="relative inline-block whitespace-nowrap">
                kia kia
                <svg
                  className="kk-underline absolute -bottom-1 left-0 h-[0.2em] w-full text-kk-orange"
                  viewBox="0 0 200 12"
                  fill="none"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 8.5C38 3.5 74 2.5 110 4.5C139 6.1 168 8.6 198 5"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              .
            </span>
          </h1>

          <p
            className="kk-enter mt-8 max-w-xl font-inter text-lg leading-8 text-kk-cocoa sm:text-xl"
            style={{ "--kk-delay": "200ms" } as React.CSSProperties}
          >
            <span className="font-semibold text-kk-ink">Kia kia</span> means quick quick — that is
            the whole promise. Order from a kitchen down the road, watch the rider close in live,
            and your money stays in escrow until a{" "}
            <span className="font-semibold text-kk-ink">4-digit code</span> at your door releases
            it.
          </p>

          <div
            className="kk-enter mt-9 flex flex-col gap-3 sm:flex-row sm:items-center"
            style={{ "--kk-delay": "280ms" } as React.CSSProperties}
          >
            <Link
              href="/register"
              className="kk-shine group inline-flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-kk-red px-8 font-inter text-base font-semibold text-white shadow-[0_18px_40px_-16px_rgba(182,25,19,0.95)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-kk-red-deep"
            >
              Start an order
              <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <Link
              href="/vendor/register"
              className="group inline-flex h-14 items-center justify-center gap-2.5 rounded-2xl border border-kk-line bg-white/70 px-7 font-inter text-base font-semibold text-kk-ink backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-kk-ink/25 hover:bg-white"
            >
              <Store className="size-5 text-kk-orange-deep" />
              Sell on KiaKia
            </Link>
          </div>

          <div
            className="kk-enter mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 font-inter text-sm text-kk-cocoa"
            style={{ "--kk-delay": "360ms" } as React.CSSProperties}
          >
            <span className="inline-flex items-center gap-2.5">
              <span className="relative flex size-2 shrink-0 text-kk-green">
                <span className="kk-ping absolute inset-0" />
                <span className="relative size-2 rounded-full bg-kk-green" />
              </span>
              Riders dispatched the second a vendor accepts
            </span>
            <span className="hidden h-4 w-px bg-kk-line sm:block" />
            <span className="inline-flex items-center gap-2">
              <Lock className="size-4 text-kk-green" />
              Escrow-protected, every order
            </span>
          </div>
        </div>

        {/* ---------------------------------------------------- visual
            The floating cards hang off the photo's edges. On narrow screens
            that would push them past the section (which clips), so the
            wrapper carries side padding there instead: the photo shrinks and
            the cards, which are positioned against the wrapper, land on top
            of its edges rather than outside the viewport. */}
        <div
          className="kk-enter relative mx-auto w-full max-w-[460px] px-7 sm:px-0 lg:max-w-[500px]"
          style={{ "--kk-delay": "260ms" } as React.CSSProperties}
        >
          {/* Photo card */}
          <div className="relative aspect-[4/5] rotate-[2.5deg] overflow-hidden rounded-[40px] border-4 border-white shadow-[0_50px_90px_-35px_rgba(90,25,20,0.55)] transition-transform duration-700 hover:rotate-0">
            <Image
              src="/assets/hero-banner.png"
              alt="A freshly made burger and hand-cut fries plated at a KiaKia vendor kitchen"
              fill
              sizes="(max-width: 1024px) 90vw, 500px"
              className="scale-[1.15] object-cover object-center"
              preload
            />
            <div className="absolute inset-0 bg-gradient-to-t from-kk-ink-deep/70 via-kk-ink-deep/5 to-transparent" />

            <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl bg-white/15 p-3 backdrop-blur-md ring-1 ring-inset ring-white/25">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-kk-orange font-sora text-lg font-bold text-white">
                M
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-inter text-sm font-semibold text-white">
                  Mama Ngozi&apos;s Kitchen
                  <BadgeCheck className="size-4 shrink-0 text-kk-mint" />
                </span>
                <span className="block truncate font-inter text-xs text-white/75">
                  1.2 km away · Opens 8:00 AM
                </span>
              </span>
            </div>
          </div>

          {/* Live tracking card */}
          <div
            className="kk-float absolute left-0 top-8 w-[232px] sm:-left-10 sm:top-10 sm:w-[248px]"
            style={{ "--kk-delay": "0ms" } as React.CSSProperties}
          >
            <div className="rounded-3xl border border-kk-line/70 bg-white/95 p-4 shadow-[0_30px_60px_-25px_rgba(28,27,27,0.45)] backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <span className="font-inter text-[11px] font-semibold uppercase tracking-[0.16em] text-kk-cocoa">
                  Order #KK-2481
                </span>
                <span className="relative flex size-1.5 text-kk-red">
                  <span className="kk-ping absolute inset-0" />
                  <span className="relative size-1.5 rounded-full bg-kk-red" />
                </span>
              </div>

              <p className="mt-3 flex items-center gap-2 font-sora text-[15px] font-bold text-kk-ink">
                <Bike className="size-4 text-kk-red" />
                Rider 6 minutes away
              </p>

              <div className="kk-progress relative mt-3 h-1.5 overflow-hidden rounded-full bg-kk-sand" />

              <div className="mt-2.5 flex justify-between font-inter text-[11px] text-kk-cocoa">
                <span>Picked up</span>
                <span className="font-semibold text-kk-ink">At your door</span>
              </div>
            </div>
          </div>

          {/* Escrow chip */}
          <div
            className="kk-float absolute bottom-24 right-0 w-[196px] sm:-right-8 sm:bottom-28 sm:w-[210px]"
            style={{ "--kk-delay": "1400ms" } as React.CSSProperties}
          >
            <div className="rounded-3xl bg-kk-ink-deep p-4 shadow-[0_30px_60px_-25px_rgba(18,13,12,0.8)]">
              <span className="flex items-center gap-2 font-inter text-[11px] font-semibold uppercase tracking-[0.16em] text-kk-mint">
                <Lock className="size-3.5" />
                Held in escrow
              </span>
              <p className="mt-2 font-sora text-2xl font-extrabold tracking-tight text-white">
                ₦8,450
              </p>
              <p className="mt-1 font-inter text-[11px] leading-4 text-white/60">
                Released the moment you share your code.
              </p>
            </div>
          </div>

          {/* Code chip. Desktop only — on a phone the two cards above already
              fill the frame, and a third would crowd the photo out. The
              rotation sits on an inner element because kk-float animates
              `transform`, which would otherwise replace it. */}
          <div
            className="kk-float absolute -top-3 right-0 hidden sm:-right-6 sm:block"
            style={{ "--kk-delay": "700ms" } as React.CSSProperties}
          >
            <div className="flex -rotate-6 items-center gap-1.5 rounded-2xl border border-kk-line bg-kk-cream px-3 py-2.5 shadow-[0_20px_40px_-20px_rgba(28,27,27,0.5)]">
              {["4", "0", "9", "1"].map((digit, i) => (
                <span
                  key={`${digit}-${i}`}
                  className="flex size-8 items-center justify-center rounded-lg bg-white font-sora text-base font-extrabold text-kk-ink ring-1 ring-inset ring-kk-line"
                >
                  {digit}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
