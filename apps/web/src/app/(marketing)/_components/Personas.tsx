// app/(marketing)/_components/Personas.tsx
import Link from "next/link";
import { ArrowRight, Bike, ShoppingBag, Store } from "lucide-react";
import { Reveal } from "./Reveal";

export function Personas() {
  return (
    <section className="bg-kk-cream px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="max-w-3xl">
            <p className="flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red">
              <span className="h-px w-8 bg-kk-red/50" />
              Three ways in
            </p>
            <h2 className="mt-5 font-sora text-[clamp(2rem,4.6vw,3.25rem)] font-extrabold leading-[1.03] tracking-[-0.03em] text-kk-ink">
              Whichever side of the order you&apos;re on.
            </h2>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {/* ------------------------------------------------- customer */}
          <Reveal className="h-full">
            <article className="group relative flex h-full flex-col overflow-hidden rounded-[32px] bg-kk-red p-8 text-white shadow-[0_35px_70px_-35px_rgba(182,25,19,0.9)] sm:p-9">
              <div aria-hidden="true" className="kk-dots absolute inset-0 text-white/25" />
              <div
                aria-hidden="true"
                className="absolute -right-16 -top-16 size-56 rounded-full bg-white/10 transition-transform duration-700 group-hover:scale-125"
              />

              <div className="relative flex flex-1 flex-col">
                <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25">
                  <ShoppingBag className="size-6" />
                </span>
                <h3 className="mt-7 font-sora text-3xl font-extrabold tracking-tight">Order</h3>
                <p className="mt-3 font-inter text-[15px] leading-7 text-white/80">
                  Food, groceries, that thing you forgot. Pay once, track the rider, release the
                  money when it&apos;s in your hand.
                </p>
                <ul className="mt-7 space-y-2.5 font-inter text-sm text-white/85">
                  <Bullet tone="light">Escrow on every single order</Bullet>
                  <Bullet tone="light">Live map from pickup to your door</Bullet>
                  <Bullet tone="light">Card or bank transfer at checkout</Bullet>
                </ul>
                <Link
                  href="/register"
                  className="kk-shine group/cta mt-9 inline-flex items-center justify-center gap-2 self-start rounded-2xl bg-white px-7 py-3.5 font-inter text-[15px] font-semibold text-kk-red transition-transform duration-300 hover:-translate-y-0.5"
                >
                  Create an account
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover/cta:translate-x-1" />
                </Link>
              </div>
            </article>
          </Reveal>

          {/* --------------------------------------------------- vendor */}
          <Reveal delay={110} className="h-full">
            <article className="group relative flex h-full flex-col overflow-hidden rounded-[32px] border border-kk-line bg-white p-8 shadow-[0_25px_50px_-35px_rgba(28,27,27,0.5)] transition-shadow duration-500 hover:shadow-[0_35px_70px_-35px_rgba(147,75,0,0.55)] sm:p-9">
              <div
                aria-hidden="true"
                className="absolute -right-14 -top-14 size-48 rounded-full bg-kk-orange/10 transition-transform duration-700 group-hover:scale-125"
              />
              <div className="relative flex flex-1 flex-col">
                <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-kk-orange/15 text-kk-orange-deep">
                  <Store className="size-6" />
                </span>
                <h3 className="mt-7 font-sora text-3xl font-extrabold tracking-tight text-kk-ink">
                  Sell
                </h3>
                <p className="mt-3 font-inter text-[15px] leading-7 text-kk-cocoa">
                  Put your kitchen or shop in front of the street. Escrow means the payment is
                  already committed before you start cooking.
                </p>
                <ul className="mt-7 space-y-2.5 font-inter text-sm text-kk-cocoa">
                  <Bullet tone="dark">Guaranteed payout on hand-off</Bullet>
                  <Bullet tone="dark">No chargebacks, no &ldquo;I&apos;ll pay later&rdquo;</Bullet>
                  <Bullet tone="dark">Menu, hours and orders in one dashboard</Bullet>
                </ul>
                <Link
                  href="/vendor/register"
                  className="group/cta mt-9 inline-flex items-center justify-center gap-2 self-start rounded-2xl bg-kk-ink px-7 py-3.5 font-inter text-[15px] font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-kk-ink-deep"
                >
                  Become a vendor
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover/cta:translate-x-1" />
                </Link>
              </div>
            </article>
          </Reveal>

          {/* ---------------------------------------------------- rider */}
          <Reveal delay={220} className="h-full">
            <article className="relative flex h-full flex-col overflow-hidden rounded-[32px] bg-kk-ink p-8 text-white sm:p-9">
              <div aria-hidden="true" className="kk-grid absolute inset-0 text-white/6" />
              <div className="relative flex flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-kk-mint/20 text-kk-mint">
                    <Bike className="size-6" />
                  </span>
                  <span className="rounded-full border border-kk-mint/30 px-3 py-1 font-inter text-[11px] font-semibold uppercase tracking-[0.14em] text-kk-mint">
                    Coming soon
                  </span>
                </div>
                <h3 className="mt-7 font-sora text-3xl font-extrabold tracking-tight">Ride</h3>
                <p className="mt-3 font-inter text-[15px] leading-7 text-white/60">
                  Dispatch offers land on your phone, you accept the ones you want, and the fare is
                  already funded before you move.
                </p>
                <ul className="mt-7 space-y-2.5 font-inter text-sm text-white/70">
                  <Bullet tone="light">Accept or pass on every offer</Bullet>
                  <Bullet tone="light">Fare escrowed before pickup</Bullet>
                  <Bullet tone="light">Paid the moment the code is entered</Bullet>
                </ul>
                <p className="mt-9 rounded-2xl border border-dashed border-white/20 px-5 py-3.5 font-inter text-[13px] leading-5 text-white/50">
                  Rider sign-up opens with the next release. The dispatch and payout side is
                  already built.
                </p>
              </div>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Bullet({ children, tone }: { children: React.ReactNode; tone: "light" | "dark" }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className={`mt-2 size-1.5 shrink-0 rounded-full ${tone === "light" ? "bg-current opacity-60" : "bg-kk-orange"}`}
      />
      {children}
    </li>
  );
}
