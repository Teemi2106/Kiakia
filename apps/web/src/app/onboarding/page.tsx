// app/(auth)/onboarding/page.tsx
import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { OnboardingDesktop } from "./_components/OnboardingDesktop";
import { OnboardingMobile } from "./_components/OnboardingMobile";

export const metadata: Metadata = { title: "Become a Vendor" };

// Deliberately NOT inside the (vendor) route group — that layout's
// requireRole() redirects anyone WITHOUT a vendor role to /home, which is
// exactly the audience this page is for. verifySession() only: any
// authenticated user may apply.
export default async function OnboardingPage() {
  await verifySession();

  return (
    <>
      <div className="hidden md:block">
        <OnboardingDesktop />
      </div>
      <div className="md:hidden">
        <OnboardingMobile />
      </div>
    </>
  );
}