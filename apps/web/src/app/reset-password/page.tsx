import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Card>
          <h1 className="text-xl font-semibold text-ink">Set a new password</h1>
          {linkIsValid ? (
            <div className="mt-6">
              <ResetPasswordForm />
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink-muted">
                This reset link is invalid or has expired.
              </p>
              <Link href="/forgot-password" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
                Request a new link
              </Link>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
