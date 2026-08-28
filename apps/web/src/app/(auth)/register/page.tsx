import type { Metadata } from "next";
import { AuthLegal, AuthShell, AuthSwap } from "../_components/AuthShell";
import { EscrowCodeCard } from "../_components/AuthStage";
import { RegisterForm } from "../_components/RegisterForm";

export const metadata: Metadata = {
  title: "Create an account",
  description:
    "Join KiaKia to experience high-velocity food delivery with zero compromises on quality.",
  openGraph: {
    title: "Create an account | KiaKia",
    description:
      "Join KiaKia to experience high-velocity food delivery with zero compromises on quality.",
    images: ["/assets/signup-image.png"],
  },
};

export default function RegisterPage() {
  return (
    <AuthShell
      backHref="/"
      backLabel="Back to home"
      role="customer"
      stage={{
        imageSrc: "/assets/signup-image.png",
        altText: "A KiaKia vendor preparing a fresh meal in their kitchen",
        eyebrow: "Zero-trust delivery",
        heading: (
          <>
            Order kia kia.
            <br />
            Pay on your terms.
          </>
        ),
        subheading:
          "Kitchens and shops down the road, a rider you can watch in real time, and your money held safely until the food is in your hand.",
        panel: <EscrowCodeCard />,
        footnote: "Free to join. No subscription, no card stored until you order.",
      }}
      title="Create your account"
      subtitle="Two minutes now, and every order after this one takes seconds."
      footer={<AuthSwap prompt="Already have an account?" href="/login" cta="Sign in" />}
      legal={<AuthLegal verb="creating an account," />}
    >
      <RegisterForm />
    </AuthShell>
  );
}
