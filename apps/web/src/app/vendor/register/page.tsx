import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { vendorRegisterAction } from "@/app/actions/auth";
import { RegisterForm } from "@/app/(auth)/_components/RegisterForm";

export const metadata: Metadata = { title: "Become a Vendor" };

export default function VendorRegisterPage() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-xl font-semibold text-ink">Partner with KiaKia</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Create a vendor account to list your kitchen or store on KiaKia.
        </p>
        <div className="mt-6">
          <RegisterForm action={vendorRegisterAction} />
        </div>
      </Card>
      <p className="text-center text-sm text-ink-muted">
        Already a vendor?{" "}
        <Link href="/vendor/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
