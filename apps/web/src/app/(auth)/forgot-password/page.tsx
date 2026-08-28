import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ImagePane from "../_components/ImagePane";
import { ForgotPasswordForm } from "../_components/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your KiaKia account.",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col bg-[#FCF9F8] lg:flex-row">
      <ImagePane
        imageSrc="/assets/login-image.png"
        altText="A KiaKia customer enjoying a freshly delivered meal"
        heading="Forgot your password?"
        subheading="No stress — we'll send you a link to get back into your account in a few taps."
      />

      <div className="flex flex-1 flex-col lg:w-1/2 lg:items-center lg:justify-center">
        {/* Mobile back button */}
        <header className="flex h-14 w-full items-center px-4 lg:hidden">
          <Link
            href="/login"
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5"
            aria-label="Back to sign in"
          >
            <ChevronLeft className="size-4 text-[#1C1B1B]" />
          </Link>
        </header>

        <div className="w-full flex-1 px-4 pb-8 lg:max-w-[440px] lg:flex-none lg:px-4 lg:py-8">
          <div className="rounded-xl border border-[#E5E2E1] bg-white p-6 shadow-[0px_4px_24px_rgba(26,26,26,0.04)] lg:p-10">
            <div className="mb-8 space-y-2">
              <h1 className="font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B] lg:text-[32px] lg:leading-10 lg:tracking-[-0.32px]">
                Forgot your password?
              </h1>
              <p className="font-inter text-base leading-6 text-[#5B403C]">
                Enter the email on your account and we&apos;ll send you a link to reset your password.
              </p>
            </div>

            <ForgotPasswordForm />

            <p className="mt-6 text-center font-inter text-base leading-6 text-[#5B403C]">
              Remembered it?{" "}
              <Link href="/login" className="font-semibold text-[#B61913] hover:underline">
                Back to sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
