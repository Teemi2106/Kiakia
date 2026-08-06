import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "../_components/LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Card>
          <h1 className="text-xl font-semibold text-ink">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-muted">Enter your details to access your account.</p>
          <div className="mt-6">
            <LoginForm />
          </div>
        </Card>
        <p className="mt-4 text-center text-sm text-ink-muted">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-brand-600 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
