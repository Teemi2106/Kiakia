// app/(vendor)/register/_components/VendorRegisterDesktop.tsx
import Link from "next/link";
import Image from "next/image";
import { vendorRegisterAction } from "@/app/actions/auth";
import { RegisterForm } from "@/app/(auth)/_components/RegisterForm";
import { ValueProps } from "./ValueProps";

export function VendorRegisterDesktop() {
  return (
    <div className="relative flex w-full items-center px-6 justify-center overflow-hidden">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -left-[5%] -top-[10%] h-96 w-96 rounded-full bg-[#FFDAD5] opacity-30 blur-3xl" />
      <div className="pointer-events-none absolute -right-[5%] -bottom-[10%] h-96 w-96 rounded-full bg-[#FFDCC5] opacity-30 blur-3xl" />

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
          <h1 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.01em] text-[#1C1B1B]">
            Grow your food business with us.
          </h1>
          <p className="font-inter text-[18px] leading-7 text-[#5B403C]">
            Join thousands of vendors delivering speed, freshness, and reliability to hungry customers daily.
          </p>
          <ValueProps />
        </div>

        {/* Right Column - Registration Form */}
        <div className="w-full md:w-7/12">
          <div className="rounded-2xl border border-[rgba(230,228,222,0.5)] bg-white/95 p-6 shadow-sm backdrop-blur-sm md:p-8">
            {/* Mobile-only header */}
            <div className="mb-6 text-center md:hidden">
              <Link href="/" className="mb-2 block font-sora text-[28px] font-bold leading-[34px] font-extrabold text-[#B61913]">
                KiaKia
              </Link>
              <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">Vendor Registration</h2>
            </div>
            <RegisterForm action={vendorRegisterAction} />
            <div className="mt-4 text-center">
              <p className="font-inter text-sm text-[#5B403C]">
                Already a vendor?{" "}
                <Link href="/vendor/login" className="font-semibold text-[#934B00] hover:underline">
                  Login here
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}