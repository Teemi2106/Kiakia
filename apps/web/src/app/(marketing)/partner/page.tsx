// app/(marketing)/partner/page.tsx
//
// The step between "Partner with KiaKia" on the landing page and the vendor
// sign-up form: it tells a would-be vendor what KiaKia is to them before
// asking for an account. Static apart from the header's account read.
import { ArrowRight, Bike, ClipboardCheck, MapPin, Store, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RiderRoute } from "@/app/_components/RiderRoute";
import { getMarketingAccount } from "@/lib/auth/marketing-account";
import { Footer } from "../_components/Footer";
import { Header } from "../_components/Header";
import { Reveal } from "../_components/Reveal";

export const metadata: Metadata = {
  title: "Partner with KiaKia",
  description:
    "KiaKia puts your kitchen or shop in front of hungry customers nearby, sends a rider for every order, and pays you when it is delivered.",
};

const BENEFITS = [
  {
    icon: MapPin,
    title: "Customers on your street",
    body: "People nearby see your menu first. You are not competing with kitchens across the city.",
  },
  {
    icon: Bike,
    title: "Riders, sorted for you",
    body: "When an order is ready, the nearest available riders are notified automatically. No calling around.",
  },
  {
    icon: Wallet,
    title: "Paid when it is delivered",
    body: "The customer's payment is held safely until the order is handed over, then your share is released.",
  },
] as const;

const STEPS = [
  { title: "Create your account", body: "It takes a minute. Name, email and a password." },
  { title: "Add your store and menu", body: "Your details, your dishes, your prices and your opening hours." },
  { title: "We review your store", body: "The KiaKia team checks every store before customers can see it." },
  { title: "Start taking orders", body: "Accept, prepare, hand over to the rider. We handle the rest." },
] as const;

export default async function PartnerPage() {
  const account = await getMarketingAccount();

  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header account={account} />

      <section className="relative overflow-hidden pb-16 pt-6 sm:pb-24 sm:pt-10">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="kk-blob -left-40 -top-40 size-[520px] bg-kk-orange/30" />
          <div className="kk-blob -right-32 top-20 size-[460px] bg-kk-red/20" />
        </div>

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-8">
          <div>
            <p className="flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red">
              <span className="h-px w-8 bg-kk-red/50" />
              For kitchens and shops
            </p>
            <h1 className="mt-5 font-sora text-[clamp(2.25rem,6vw,4.25rem)] font-extrabold leading-[1] tracking-[-0.04em] text-kk-ink">
              Your food, at every door
              <br /> around you.
            </h1>
            <p className="mt-6 max-w-xl font-inter text-lg leading-8 text-kk-cocoa sm:text-xl">
              KiaKia is how nearby customers find you, order from you and get their food fast fast.
              You cook. We bring the customers and the riders.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/vendor/register"
                className="kk-shine group inline-flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-kk-red px-8 font-inter text-base font-semibold text-white shadow-[0_18px_40px_-16px_rgba(182,25,19,0.95)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-kk-red-deep"
              >
                Create your vendor account
                <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
              <Link
                href="/vendor/login"
                className="inline-flex h-14 items-center justify-center rounded-2xl border border-kk-line bg-white/70 px-7 font-inter text-base font-semibold text-kk-ink backdrop-blur transition-all duration-300 hover:border-kk-ink/25 hover:bg-white"
              >
                Already a vendor? Sign in
              </Link>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[420px] rounded-[40px] border border-white bg-white/70 p-4 shadow-[0_40px_80px_-40px_rgba(90,25,20,0.5)] backdrop-blur">
            <RiderRoute label="Your customer" className="h-auto w-full" />
          </div>
        </div>
      </section>

      <section className="bg-kk-ink-deep px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="max-w-2xl font-sora text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold leading-[1.05] tracking-[-0.03em] text-white">
            What KiaKia does for you
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {BENEFITS.map((item, i) => (
              <Reveal key={item.title} delay={i * 100}>
                <div className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-kk-orange/20 text-kk-orange ring-1 ring-inset ring-white/15">
                    <item.icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-sora text-base font-bold text-white">{item.title}</h3>
                    <p className="mt-1.5 max-w-xs font-inter text-[14px] leading-6 text-white/60">
                      {item.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red">
            <span className="h-px w-8 bg-kk-red/50" />
            Getting started
          </p>
          <h2 className="mt-5 max-w-2xl font-sora text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold leading-[1.05] tracking-[-0.03em] text-kk-ink">
            From sign-up to your first order
          </h2>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="rounded-3xl border border-kk-line/70 bg-white/70 p-6 shadow-[0_20px_50px_-45px_rgba(66,29,20,0.5)]"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-kk-red/10 font-sora text-sm font-bold text-kk-red">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-sora text-lg font-bold text-kk-ink">{step.title}</h3>
                <p className="mt-2 font-inter text-[15px] leading-6 text-kk-cocoa">{step.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-12 flex flex-col items-start gap-4 rounded-3xl bg-kk-red p-8 text-white sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                <Store className="size-6" />
              </span>
              <p className="font-sora text-xl font-bold leading-tight">Ready to put your kitchen on KiaKia?</p>
            </div>
            <Link
              href="/vendor/register"
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-white px-6 font-inter text-sm font-semibold text-kk-red transition-transform duration-300 hover:-translate-y-0.5"
            >
              <ClipboardCheck className="size-4" />
              Create your vendor account
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
