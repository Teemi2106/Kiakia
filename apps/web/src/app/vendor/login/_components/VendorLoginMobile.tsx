// app/(vendor)/login/_components/VendorLoginMobile.tsx
"use client";

import Link from "next/link";
import Image from "next/image"
import { useRouter } from "next/navigation";
import { X, Store } from "lucide-react";
import { vendorLoginAction } from "@/app/actions/auth";
import { LoginForm } from "@/app/(auth)/_components/LoginForm";

export function VendorLoginMobile() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col bg-[#FCF9F8]">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 flex h-14 w-full items-center justify-between bg-[#FCF9F8] px-4">
        <button
          onClick={() => router.back()}
          className="flex items-center justify-center rounded-full p-2 text-[#5B403C] active:bg-[#F0EDED]"
          aria-label="Go back"
        >
          <X className="size-6" />
        </button>
        <span className="font-sora text-2xl font-bold text-[#B61913]">
          <Image
              src="/assets/logo-mark.png"
              alt="KiaKia"
              width={160}
              height={80}
              className="h-auto w-auto max-h-12 object-contain"
              priority
            />
        </span>
        <div className="w-10" /> {/* Spacer */}
      </header>

      {/* Main Content */}
      <main className="flex flex-1 flex-col justify-center px-4 pb-safe pt-8">
        {/* Header Section */}
        <div className="mb-12 text-center">
          <h1 className="mb-2 font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B]">
            Vendor Sign In
          </h1>
          <p className="font-inter text-base leading-6 text-[#5B403C]">
            Manage your orders and reach more customers.
          </p>
        </div>

        {/* Login Form */}
        <div className="mx-auto w-full max-w-[400px]">
          <LoginForm action={vendorLoginAction} />

          {/* Divider */}
          <div className="relative flex items-center py-4">
            <div className="flex-grow border-t border-[#E4BEB8]" />
            <span className="mx-4 flex-shrink-0 font-inter text-xs font-medium leading-4 text-[#5B403C]">
              New to KiaKia?
            </span>
            <div className="flex-grow border-t border-[#E4BEB8]" />
          </div>

          {/* Register Link */}
          <Link
            href="/vendor/register"
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#934B00] bg-white py-3 font-inter text-sm font-semibold leading-5 tracking-[0.01em] text-[#934B00] transition-all hover:bg-[#F6F3F2] active:scale-[0.98]"
          >
            Register your Kitchen
            <Store className="size-5" />
          </Link>
        </div>
      </main>
    </div>
  );
}