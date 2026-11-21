// app/(marketing)/_components/FinalCta.tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { switchToCustomerAction } from "@/app/actions/session";
import type { MarketingAccount } from "@/lib/auth/marketing-account";
import { Reveal } from "./Reveal";

export function FinalCta({ account }: { account: MarketingAccount | null }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-kk-red via-kk-red to-kk-red-deep px-4 pb-0 pt-20 sm:px-6 sm:pt-28 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="kk-dots absolute inset-0 text-white/20" />
        <div className="kk-blob -right-20 -top-24 size-[420px] bg-kk-orange/40" />
      </div>

      <Reveal>
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="font-sora text-[clamp(2.25rem,5.6vw,4rem)] font-extrabold leading-[1] tracking-[-0.035em] text-white">
            You are hungry.
            <br />
            Let us fix that.
          </h2>
          <p className="mx-auto mt-6 max-w-xl font-inter text-lg leading-8 text-white/75">
            Free to join, nothing to install. Pick a kitchen and we will have it at your door fast fast.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {account ? (
              <>
                <form action={switchToCustomerAction} className="w-full sm:w-auto">
                  <button
                    type="submit"
                    className="kk-shine group inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-white px-8 font-inter text-base font-semibold text-kk-red shadow-[0_20px_45px_-20px_rgba(0,0,0,0.6)] transition-transform duration-300 hover:-translate-y-0.5 sm:w-auto"
                  >
                    Are you hungry?
                    <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link
                  href="/home"
                  className="kk-shine group inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-white px-8 font-inter text-base font-semibold text-kk-red shadow-[0_20px_45px_-20px_rgba(0,0,0,0.6)] transition-transform duration-300 hover:-translate-y-0.5 sm:w-auto"
                >
                  Order something now
                  <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </>
            )}
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
