// app/(auth)/onboarding/_components/OnboardingMobile.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Store } from "lucide-react";
import { VendorOnboardingForm } from "./VendorOnboardingForm";

export function OnboardingMobile() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#FCF9F8]">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 flex h-14 w-full items-center bg-[#FCF9F8] px-4">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full transition-all hover:bg-[#F0EDED] active:scale-95"
          aria-label="Go back"
        >
          <ChevronLeft className="size-5 text-[#1C1B1B]" />
        </button>
        <div className="flex flex-1 justify-center">
          {/* Progress Dots */}
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[#B61913]" />
            <div className="h-2 w-2 rounded-full bg-[#DCD9D9]" />
            <div className="h-2 w-2 rounded-full bg-[#DCD9D9]" />
          </div>
        </div>
        <div className="w-11" /> {/* Spacer */}
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full px-4 py-6 pb-safe-bottom">
        {/* Header Section */}
        <div className="mb-6">
          <h1 className="mb-2 font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B]">
            Partner with{" "}
            <span className="inline-block">
              <Image
                src="/assets/logo-mark.png"
                alt="KiaKia"
                width={32}
                height={32}
                className="inline-block h-8 w-auto object-contain align-middle"
                priority
              />
            </span>
          </h1>
          <p className="font-inter text-base leading-6 text-[#5B403C]">
            Let&apos;s get your store set up and ready to serve hungry customers.
          </p>
        </div>

        {/* Hero Image */}
        <div className="relative mb-6 h-40 w-full overflow-hidden rounded-2xl bg-[#F0EDED]">
          <Image
            src="/assets/signup-image.png"
            alt="Kitchen Prep"
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[rgba(49,48,48,0.6)] to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2">
            <div className="rounded-full bg-[#FCF9F8] p-2 shadow-sm">
              <Store className="size-4 text-[#B61913]" />
            </div>
            <span className="font-inter text-sm font-semibold leading-5 tracking-[0.01em] text-white">
              Step 1: Store Details
            </span>
          </div>
        </div>

        {/* Onboarding Form */}
        <VendorOnboardingForm />

        {/* Footer Note */}
        <div className="mt-4 text-center pb-8">
          <p className="font-inter text-xs font-medium leading-4 text-[#5B403C]">
            By continuing, you agree to KiaKia&apos;s{" "}
            <Link href="/terms" className="text-[#B61913] underline">
              Vendor Terms
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}