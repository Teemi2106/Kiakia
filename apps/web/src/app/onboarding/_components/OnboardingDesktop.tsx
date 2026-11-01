// app/(auth)/onboarding/_components/OnboardingDesktop.tsx
import Image from "next/image";
import Link from "next/link";
import { Store, Rocket, Shield } from "lucide-react";
import { VendorOnboardingForm } from "./VendorOnboardingForm";

export function OnboardingDesktop() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-kk-cream px-4 py-12 overflow-hidden">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -left-[5%] -top-[10%] h-96 w-96 rounded-full bg-kk-danger-wash opacity-30 blur-3xl" />
      <div className="pointer-events-none absolute -right-[5%] -bottom-[10%] h-96 w-96 rounded-full bg-notice-surface opacity-30 blur-3xl" />

      <div className="relative z-10 flex w-full max-w-6xl flex-col gap-8 lg:gap-12 md:flex-row">
        {/* Left Column - Trust/Value Proposition */}
        <div className="hidden w-full flex-col justify-center space-y-6 md:flex md:w-5/12">
          <Link href="/" className="mb-4 block">
            <Image
              src="/assets/logo-mark.png"
              alt="KiaKia"
              width={160}
              height={80}
              className="h-auto w-auto max-h-12 object-contain"
              priority
            />
          </Link>
          <h1 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.01em] text-kk-ink">
            Verify Your store
          </h1>
          <p className="font-inter text-[18px] leading-7 text-kk-cocoa">
            Join thousands of vendors delivering speed, freshness, and reliability to hungry customers daily.
          </p>
          <div className="mt-8 space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-kk-hair">
                <Rocket className="size-5 text-kk-red-ink" />
              </div>
              <div>
                <h3 className="font-inter text-sm font-semibold leading-5 tracking-[0.01em] text-kk-ink">
                  Fast Onboarding
                </h3>
                <p className="font-inter text-sm leading-6 text-kk-cocoa">
                  Get started in minutes.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-kk-hair">
                <Shield className="size-5 text-kk-green-ink" />
              </div>
              <div>
                <h3 className="font-inter text-sm font-semibold leading-5 tracking-[0.01em] text-kk-ink">
                  Secure Payments
                </h3>
                <p className="font-inter text-sm leading-6 text-kk-cocoa">
                  Your payout is secured on every order.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Onboarding Form */}
        <div className="w-full md:w-7/12">
          <div className="rounded-2xl border border-[rgba(230,228,222,0.5)] bg-kk-card/95 p-6 shadow-sm backdrop-blur-sm md:p-8">
            {/* Mobile-only header */}
            <div className="mb-6 text-center md:hidden">
              <Link href="/" className="mb-2 block font-sora text-[28px] font-bold leading-[34px] font-extrabold text-kk-red-ink">
                KiaKia
              </Link>
              <h2 className="font-sora text-2xl font-semibold text-kk-ink">Become a Vendor</h2>
            </div>

            <VendorOnboardingForm />
          </div>
        </div>
      </div>
    </main>
  );
}