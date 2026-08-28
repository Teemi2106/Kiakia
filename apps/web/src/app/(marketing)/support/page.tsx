// app/(marketing)/support/page.tsx
import type { Metadata } from "next";
import { getMarketingAccount } from "@/lib/auth/marketing-account";
import { Header } from "../_components/Header";
import { Footer } from "../_components/Footer";

export const metadata: Metadata = { title: "Support" };

// PLACEHOLDER — not a real support line yet, just wired to unblock the
// "Live chat" link. Swap for KiaKia's actual WhatsApp Business number
// before launch.
const WHATSAPP_SUPPORT_NUMBER = "2340000000000";
const WHATSAPP_SUPPORT_URL = `https://wa.me/${WHATSAPP_SUPPORT_NUMBER}`;

export default async function SupportPage() {
  const account = await getMarketingAccount();

  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header account={account} />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <h1 className="font-sora text-3xl font-bold text-[#1C1B1B]">
          Support
        </h1>
        <p className="mt-4 text-[#5B403C]">
          Dedicated in-app support channels aren&apos;t set up yet in this
          release. If you&apos;re having trouble with an order, please check
          the order&apos;s status page for the latest updates, or reach us
          on live chat below.
        </p>
        <a
          href={WHATSAPP_SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="kk-shine group mt-8 inline-flex items-center gap-2 rounded-full bg-kk-red px-5 py-2.5 font-inter text-[15px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(182,25,19,0.9)] transition-colors hover:bg-kk-red-deep"
        >
          Live chat on WhatsApp
        </a>
      </div>
      <Footer />
    </main>
  );
}
