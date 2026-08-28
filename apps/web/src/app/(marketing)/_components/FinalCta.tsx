// app/(marketing)/_components/FinalCta.tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./Reveal";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-kk-red via-kk-red to-kk-red-deep px-4 pb-0 pt-20 sm:px-6 sm:pt-28 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="kk-dots absolute inset-0 text-white/20" />
        <div className="kk-blob -right-20 -top-24 size-[420px] bg-kk-orange/40" />
      </div>

      <Reveal>
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="font-sora text-[clamp(2.25rem,5.6vw,4rem)] font-extrabold leading-[1] tracking-[-0.035em] text-white">
            Order something.
            <br />
            Keep your money till it lands.
          </h2>
          <p className="mx-auto mt-6 max-w-xl font-inter text-lg leading-8 text-white/75">
            Free to join, nothing to install, and escrow on the very first order you place.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="kk-shine group inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-white px-8 font-inter text-base font-semibold text-kk-red shadow-[0_20px_45px_-20px_rgba(0,0,0,0.6)] transition-transform duration-300 hover:-translate-y-0.5 sm:w-auto"
            >
              Start an order
              <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <Link
              href="/vendor/register"
              className="inline-flex h-14 w-full items-center justify-center rounded-2xl border border-white/35 px-8 font-inter text-base font-semibold text-white transition-colors duration-300 hover:bg-white/10 sm:w-auto"
            >
              Sell on KiaKia
            </Link>
          </div>
        </div>
      </Reveal>

      {/* Oversized wordmark bleeding off the bottom edge. */}
      <p
        aria-hidden="true"
        className="pointer-events-none relative mt-16 select-none text-center font-sora text-[clamp(4.5rem,19vw,16rem)] font-extrabold leading-[0.72] tracking-[-0.05em] text-white/10 sm:mt-20"
      >
        KiaKia
      </p>
    </section>
  );
}
