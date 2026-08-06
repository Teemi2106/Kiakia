import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { vendorLoginAction } from "@/app/actions/auth";
import { LoginForm } from "@/app/(auth)/_components/LoginForm";

export const metadata: Metadata = { title: "Vendor sign in" };

export default function VendorLoginPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-xl font-semibold text-ink">Vendor sign in</h1>
        <p className="mt-1 text-sm text-ink-muted">Sign in to manage your store on KiaKia.</p>
        <div className="mt-6">
          <LoginForm action={vendorLoginAction} />
        </div>
      </Card>
      <p className="text-center text-sm text-ink-muted">
        Don&apos;t have a vendor account?{" "}
        <Link href="/vendor/register" className="font-medium text-brand-600 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
