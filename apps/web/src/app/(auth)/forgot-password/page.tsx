import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "../_components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Card>
          <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Enter the email address on your account and we&apos;ll send a link to reset your password.
          </p>
          <div className="mt-6">
            <ForgotPasswordForm />
          </div>
        </Card>
        <p className="mt-4 text-center text-sm text-ink-muted">
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
