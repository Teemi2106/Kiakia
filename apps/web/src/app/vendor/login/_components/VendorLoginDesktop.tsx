// app/(vendor)/login/_components/VendorLoginDesktop.tsx
import Image from "next/image";
import Link from "next/link";
import { Store } from "lucide-react";
import { vendorLoginAction } from "@/app/actions/auth";
import { LoginForm } from "@/app/(auth)/_components/LoginForm";

export function VendorLoginDesktop() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FCF9F8] p-4 md:p-6">
      <div className="w-full max-w-[1024px] overflow-hidden rounded-2xl border border-[#E5E2E1] bg-white shadow-sm md:rounded-[24px] md:flex">
        {/* Left Side: Brand Imagery */}
        <section className="relative hidden min-h-[600px] w-full bg-[#E5E2E1] md:block md:w-1/2">
          <Image
            src="/assets/hero-banner.png"
            alt="Modern commercial kitchen"
            fill
            className="object-cover"
            priority
          />
          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-[rgba(49,48,48,0.8)] via-[rgba(49,48,48,0.2)] to-transparent" />
          {/* Brand Badge */}
          <div className="absolute bottom-12 left-12 right-12 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-white">
              <Store className="size-12 text-white" />
              <span className="font-sora text-[48px] font-extrabold leading-[56px] tracking-tight text-white">
                KiaKia
              </span>
            </div>
            <p className="max-w-sm font-inter text-[18px] leading-7 text-white/90">
              Manage your kitchen&apos;s digital storefront with speed, freshness, and total reliability.
            </p>
          </div>
        </section>

        {/* Right Side: Form Area */}
        <section className="flex w-full flex-col justify-center p-8 md:w-1/2 md:p-12 lg:p-16">
          {/* Mobile Brand Header */}
          <div className="mb-8 flex items-center gap-2 text-[#B61913] md:hidden">
            <Store className="size-8" />
            <span className="font-sora text-[28px] font-bold leading-[34px] tracking-tight">
              KiaKia
            </span>
          </div>

          <div className="mb-10">
            <h1 className="mb-3 font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B] md:text-[32px] md:leading-10">
              Partner Login
            </h1>
            <p className="font-inter text-base leading-6 text-[#5B403C]">
              Access your vendor dashboard to manage incoming orders and optimize your menu.
            </p>
          </div>

          <LoginForm action={vendorLoginAction} />

          {/* Registration Link */}
          <div className="mt-12 text-center">
            <p className="font-inter text-base leading-6 text-[#5B403C]">
              Ready to reach more customers?
            </p>
            <Link
              href="/vendor/register"
              className="mt-2 inline-flex items-center justify-center rounded-xl border-2 border-[#934B00] px-6 py-3 font-inter text-sm font-semibold leading-5 tracking-[0.01em] text-[#934B00] transition-colors hover:bg-[rgba(147,75,0,0.05)]"
            >
              Become a Vendor
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}