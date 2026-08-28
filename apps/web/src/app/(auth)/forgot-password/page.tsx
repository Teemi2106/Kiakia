import type { Metadata } from "next";
import { AuthShell, AuthSwap } from "../_components/AuthShell";
import { LiveOrderCard } from "../_components/AuthStage";
import { ForgotPasswordForm } from "../_components/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your KiaKia account.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      backHref="/login"
      backLabel="Back to sign in"
      stage={{
        imageSrc: "/assets/login-image.png",
        altText: "A KiaKia customer enjoying a freshly delivered meal",
        eyebrow: "Account recovery",
        heading: (
          <>
            One email,
            <br />
            and you&apos;re back in.
          </>
        ),
        subheading:
          "We'll send a single-use link to the address on your account. Your orders, addresses and wallet are exactly where you left them.",
        panel: <LiveOrderCard />,
        footnote: "Reset links expire after a short window and can only be used once.",
      }}
      title="Forgot your password?"
      subtitle="Enter the email on your account and we'll send you a link to reset it."
      footer={<AuthSwap prompt="Remembered it?" href="/login" cta="Back to sign in" />}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
