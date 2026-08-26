// app/(marketing)/support/page.tsx
import type { Metadata } from "next";
import { Header } from "../_components/Header";
import { Footer } from "../_components/Footer";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <Header />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <h1 className="font-sora text-3xl font-bold text-[#1C1B1B]">
          Support
        </h1>
        <p className="mt-4 text-[#5B403C]">
          Live chat and dedicated support channels aren&apos;t set up yet in
          this release. If you&apos;re having trouble with an order, please
          check the order&apos;s status page for the latest updates — full
          in-app support is coming soon.
        </p>
      </div>
      <Footer />
    </main>
  );
}
