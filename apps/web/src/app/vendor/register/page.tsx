import type { Metadata } from "next";
import Link from "next/link";
import { vendorRegisterAction } from "@/app/actions/auth";
import { AuthShell, AuthSwap } from "@/app/(auth)/_components/AuthShell";
import { VendorPitchCard } from "@/app/(auth)/_components/AuthStage";
import { RegisterForm } from "@/app/(auth)/_components/RegisterForm";

export const metadata: Metadata = {
  title: "Become a Vendor",
  description:
    "Sell on KiaKia — reach customers nearby, dispatch riders automatically, and get paid the moment an order is delivered.",
};

export default function VendorRegisterPage() {
  return (
    <AuthShell
      variant="vendor"
      backHref="/"
      backLabel="Back to home"
      role="vendor"
      stage={{
        imageSrc: "/assets/hero-banner.png",
        altText: "A vendor plating a fresh order in their kitchen",
        eyebrow: "Sell on KiaKia",
        heading: (
          <>
            Grow your food
            <br />
            business with us.
          </>
        ),
        subheading:
          "Join the kitchens and shops delivering speed, freshness and reliability to hungry customers every day.",
        panel: <VendorPitchCard />,
        footnote: "Applications are reviewed quickly — most kitchens are live within a day.",
      }}
      title="Partner with KiaKia"
      subtitle="Create your account first — you'll add your store details and menu next."
      footer={<AuthSwap prompt="Already a vendor?" href="/vendor/login" cta="Sign in" />}
      legal={
        <p className="text-center font-inter text-xs leading-5 text-kk-cocoa/65">
          By continuing you agree to KiaKia&apos;s{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-kk-ink">
            Vendor Terms
          </Link>
          {" and "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-kk-ink">
            Privacy Policy
          </Link>
          .
        </p>
      }
    >
      <RegisterForm action={vendorRegisterAction} signInHref="/vendor/login" />
    </AuthShell>
  );
}
