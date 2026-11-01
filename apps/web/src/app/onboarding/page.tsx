// app/(auth)/onboarding/page.tsx
import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { getTheme } from "@/lib/theme";
import { OnboardingDesktop } from "./_components/OnboardingDesktop";
import { OnboardingMobile } from "./_components/OnboardingMobile";

export const metadata: Metadata = { title: "Become a Vendor" };

// Deliberately NOT inside the (vendor) route group — that layout's
// requireRole() redirects anyone WITHOUT a vendor role to /home, which is
// exactly the audience this page is for. verifySession() only: any
// authenticated user may apply.
export default async function OnboardingPage() {
  await verifySession();
  const theme = await getTheme();

  return (
    <div data-theme={theme} className="text-kk-ink">
      <div className="hidden md:block">
        <OnboardingDesktop />
      </div>
      <div className="md:hidden">
        <OnboardingMobile />
      </div>
      <div className="fixed bottom-4 right-4 z-50 w-28 rounded-control bg-kk-card/90 p-1 shadow-sm backdrop-blur">
        <ThemeToggle theme={theme} />
      </div>
    </div>
  );
}