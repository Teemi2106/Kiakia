import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import ImagePane from "../(auth)/_components/ImagePane";
import { ResetPasswordForm } from "../(auth)/_components/ResetPasswordForm";

export const metadata: Metadata = { title: "Set a new password" };

// Deliberately NOT inside the (auth) route group: that layout redirects
// away anyone with an active session, but exchangeCodeForSession() below
// establishes a real session as its very first step — this page has to
// stay reachable while the user is "logged in" via that recovery session.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  let linkIsValid = false;
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    linkIsValid = !error;
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#FCF9F8] lg:flex-row">
      <ImagePane
        imageSrc="/assets/login-image.png"
        altText="A KiaKia customer enjoying a freshly delivered meal"
        heading="Almost there."
        subheading="Choose a new password to get back to fast, reliable delivery."
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
            {linkIsValid ? (
              <>
                <div className="mb-8 space-y-2">
                  <h1 className="font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B] lg:text-[32px] lg:leading-10 lg:tracking-[-0.32px]">
                    Set a new password
                  </h1>
                  <p className="font-inter text-base leading-6 text-[#5B403C]">
                    Choose a strong password you haven&apos;t used before.
                  </p>
                </div>
                <ResetPasswordForm />
              </>
            ) : (
              <>
                <div className="mb-6 space-y-2">
                  <h1 className="font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B] lg:text-[32px] lg:leading-10 lg:tracking-[-0.32px]">
                    This link has expired
                  </h1>
                  <p className="font-inter text-base leading-6 text-[#5B403C]">
                    This reset link is invalid or has expired. Request a new one to continue.
                  </p>
                </div>
                <Link
                  href="/forgot-password"
                  className="flex h-[52px] w-full items-center justify-center rounded-xl bg-[#B61913] font-inter text-sm font-semibold tracking-[0.14px] text-white transition-all hover:bg-[#9e1611] active:scale-[0.98]"
                >
                  Request a new link
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
