// app/(marketing)/privacy/page.tsx
import type { Metadata } from "next";
import { Header } from "../_components/Header";
import { Footer } from "../_components/Footer";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <Header />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <div className="mb-8 rounded-xl border border-dashed border-[#E4BEB8] bg-[#FCF9F8] p-4 text-sm text-[#5B403C]">
          <strong>Placeholder page.</strong> This is not a real Privacy
          Policy — KiaKia&apos;s legal team has not yet drafted or reviewed a
          binding privacy policy. This page exists only so the &quot;Privacy
          Policy&quot; links elsewhere in the app don&apos;t 404. It must be
          replaced with reviewed legal copy before this is relied on for
          anything.
        </div>
        <h1 className="font-sora text-3xl font-bold text-[#1C1B1B]">
          Privacy Policy
        </h1>
        <p className="mt-4 text-[#5B403C]">
          Real privacy policy content has not been published yet.
        </p>
      </div>
      <Footer />
    </main>
  );
}
