import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { VendorOnboardingForm } from "./_components/VendorOnboardingForm";

export const metadata: Metadata = { title: "Become a Vendor" };

// Deliberately NOT inside the (vendor) route group — that layout's
// requireRole() redirects anyone WITHOUT a vendor role to /home, which is
// exactly the audience this page is for. verifySession() only: any
// authenticated user may apply.
export default async function OnboardingPage() {
  await verifySession();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <Card>
          <h1 className="text-xl font-semibold text-ink">Partner with KiaKia</h1>
          <p className="mt-1 text-sm text-ink-muted">
            List your kitchen or store and start reaching customers across Jabi-Utako.
          </p>
          <div className="mt-6">
            <VendorOnboardingForm />
          </div>
        </Card>
      </div>
    </main>
  );
}
