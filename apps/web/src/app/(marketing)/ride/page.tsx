// app/(marketing)/ride/page.tsx
//
// The rider counterpart to /partner. Riders use a separate mobile app that is
// still being built, so this page says what riding with KiaKia is and that it
// is coming, without a sign-up the app could not yet honour.
import { ArrowLeft, BellRing, Bike, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getMarketingAccount } from "@/lib/auth/marketing-account";
import { Footer } from "../_components/Footer";
import { Header } from "../_components/Header";
import { Reveal } from "../_components/Reveal";

export const metadata: Metadata = {
  title: "Ride with KiaKia",
  description:
    "Deliver for KiaKia: accept the orders you want, ride short trips near you and earn the full delivery fee. The rider app is coming soon.",
};

const POINTS = [
  {
    icon: BellRing,
    title: "Offers land on your phone",
    body: "When an order near you is ready, you get the offer. Accept the ones you want.",
  },
  {
    icon: Bike,
    title: "Short trips, close to you",
    body: "Orders come from kitchens in your own area, so you spend more time earning and less time riding empty.",
  },
  {
    icon: Wallet,
    title: "The delivery fee is yours",
    body: "The full delivery fee on every order goes to the rider who delivers it.",
  },
] as const;

export default async function RidePage() {
  const account = await getMarketingAccount();

  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header account={account} />

      <section className="relative flex-1 overflow-hidden pb-16 pt-6 sm:pb-24 sm:pt-10">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="kk-blob -left-40 -top-40 size-[520px] bg-kk-orange/30" />
          <div className="kk-blob -right-32 top-20 size-[460px] bg-kk-red/20" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div>
            <p className="flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red">
              <span className="h-px w-8 bg-kk-red/50" />
              For riders
              <span className="rounded-full bg-kk-orange/20 px-2.5 py-1 text-kk-orange-deep">
                Coming soon
              </span>
            </p>
            <h1 className="mt-5 font-sora text-[clamp(2.25rem,6vw,4.25rem)] font-extrabold leading-[1] tracking-[-0.04em] text-kk-ink">
              Ride with KiaKia.
              <br /> Earn fast fast.
            </h1>
            <p className="mt-6 max-w-xl font-inter text-lg leading-8 text-kk-cocoa sm:text-xl">
              Deliver food from kitchens near you, on your own terms. The KiaKia rider app is on its
              way, and this is where you will find it.
            </p>
            <Link
              href="/"
              className="mt-9 inline-flex h-12 items-center gap-2 rounded-2xl border border-kk-line bg-white/70 px-6 font-inter text-sm font-semibold text-kk-ink backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white"
            >
              <ArrowLeft className="size-4" />
              Back to home
            </Link>
          </div>

        </div>

        <div className="relative mx-auto mt-16 grid max-w-7xl gap-8 px-4 sm:px-6 md:grid-cols-3 lg:px-8">
          {POINTS.map((item, i) => (
            <Reveal key={item.title} delay={i * 100}>
              <div className="flex gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-kk-red/10 text-kk-red">
                  <item.icon className="size-5" />
                </span>
                <div>
                  <h2 className="font-sora text-base font-bold text-kk-ink">{item.title}</h2>
                  <p className="mt-1.5 max-w-xs font-inter text-[14px] leading-6 text-kk-cocoa">
                    {item.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
