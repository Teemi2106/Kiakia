import type { Metadata } from "next";
import { vendorLoginAction } from "@/app/actions/auth";
import { AuthLegal, AuthShell, AuthSwap } from "@/app/(auth)/_components/AuthShell";
import { VendorPayoutCard } from "@/app/(auth)/_components/AuthStage";
import { LoginForm } from "@/app/(auth)/_components/LoginForm";

export const metadata: Metadata = {
  title: "Vendor sign in",
  description: "Sign in to your KiaKia vendor dashboard to manage orders, menu and payouts.",
};

export default function VendorLoginPage() {
  return (
    <AuthShell
      variant="vendor"
      backHref="/"
      backLabel="Back to home"
      role="vendor"
      stage={{
        imageSrc: "/assets/hero-banner.png",
        altText: "A busy commercial kitchen preparing orders",
        eyebrow: "Partner dashboard",
        heading: (
          <>
            Your kitchen,
            <br />
            open for business.
          </>
        ),
        subheading:
          "Live orders, menu control, rider dispatch and a wallet that settles the moment a customer confirms delivery.",
        panel: <VendorPayoutCard />,
        footnote: "Escrow protects you too — funds are ring-fenced before a rider is ever assigned.",
      }}
      title="Partner login"
      subtitle="Access your dashboard to manage incoming orders and your menu."
      footer={
        <AuthSwap prompt="Ready to reach more customers?" href="/vendor/register" cta="Become a vendor" />
      }
      legal={<AuthLegal verb="signing in," />}
    >
      <LoginForm action={vendorLoginAction} />
    </AuthShell>
  );
}
