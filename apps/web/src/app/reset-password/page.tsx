import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "../(auth)/_components/AuthShell";
import { EscrowCodeCard } from "../(auth)/_components/AuthStage";
import { ResetPasswordForm } from "../(auth)/_components/ResetPasswordForm";
import "../(auth)/auth.css";

export const metadata: Metadata = { title: "Set a new password" };

// Deliberately NOT inside the (auth) route group: that layout redirects
// away anyone with an active session, but exchangeCodeForSession() below
// establishes a real session as its very first step — this page has to
// stay reachable while the user is "logged in" via that recovery session.
// It does share the group's shell and stylesheet, which is why auth.css is
// imported here rather than inherited.
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
    <AuthShell
      backHref="/login"
      backLabel="Back to sign in"
      stage={{
        imageSrc: "/assets/login-image.png",
        altText: "A KiaKia customer enjoying a freshly delivered meal",
        eyebrow: "Account recovery",
        heading: linkIsValid ? (
          <>
            Almost there.
            <br />
            One password to go.
          </>
        ) : (
          <>
            That link has
            <br />
            already done its job.
          </>
        ),
        subheading: linkIsValid
          ? "Pick something you haven't used elsewhere. You'll stay signed in on this device once it's set."
          : "Reset links are single-use and short-lived on purpose — it's what stops an old email in someone else's inbox from opening your account.",
        panel: <EscrowCodeCard />,
        footnote: "Your saved addresses, orders and wallet balance are untouched.",
      }}
      title={linkIsValid ? "Set a new password" : "This link has expired"}
      subtitle={
        linkIsValid
          ? "Choose a strong password you haven't used before."
          : "This reset link is invalid or has already been used. Request a fresh one to continue."
      }
    >
      {linkIsValid ? (
        <ResetPasswordForm />
      ) : (
        <Link
          href="/forgot-password"
          className="kk-shine flex h-14 w-full items-center justify-center rounded-2xl bg-(--auth-accent) font-inter text-[15px] font-semibold text-white shadow-[0_18px_40px_-16px_rgb(var(--auth-accent-glow)/0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-(--auth-accent-deep)"
        >
          Request a new link
        </Link>
      )}
    </AuthShell>
  );
}
