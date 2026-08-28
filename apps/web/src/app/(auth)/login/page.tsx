import type { Metadata } from "next";
import { AuthLegal, AuthShell, AuthSwap } from "../_components/AuthShell";
import { LiveOrderCard } from "../_components/AuthStage";
import { LoginForm } from "../_components/LoginForm";

export const metadata: Metadata = {
  title: "Sign in to your account",
  description:
    "Log in to KiaKia to continue enjoying high-velocity food delivery with zero compromises on quality.",
  openGraph: {
    title: "Sign in | KiaKia",
    description: "Log in to KiaKia to continue enjoying high-velocity food delivery.",
    images: ["/assets/login-image.png"],
  },
};

export default function LoginPage() {
  return (
    <AuthShell
      backHref="/"
      backLabel="Back to home"
      role="customer"
      stage={{
        imageSrc: "/assets/login-image.png",
        altText: "A KiaKia customer enjoying a freshly delivered meal",
        eyebrow: "Fast. Fresh. Reliable.",
        heading: (
          <>
            Your next meal
            <br />
            is already moving.
          </>
        ),
        subheading:
          "Sign in to pick up where you left off — saved addresses, repeat orders, and a rider you can watch close in live.",
        panel: <LiveOrderCard />,
        footnote: "Every order is escrow-protected until the code at your door releases it.",
      }}
      title="Welcome back"
      subtitle="Enter your details to get back to fast, reliable delivery."
      footer={<AuthSwap prompt="New to KiaKia?" href="/register" cta="Create an account" />}
      legal={<AuthLegal verb="signing in," />}
    >
      <LoginForm />
    </AuthShell>
  );
}
