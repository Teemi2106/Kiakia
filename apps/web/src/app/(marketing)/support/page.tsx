// app/(marketing)/support/page.tsx
import type { Metadata } from "next";
import { getMarketingAccount } from "@/lib/auth/marketing-account";
import {
  SUPPORT_EMAIL,
  SUPPORT_EMAIL_HREF,
  SUPPORT_WHATSAPP_URL,
} from "@/lib/support-contacts";
import { Header } from "../_components/Header";
import { Footer } from "../_components/Footer";

export const metadata: Metadata = {
  title: "Support",
  alternates: { canonical: "/support" },
};

export default async function SupportPage() {
  const account = await getMarketingAccount();

  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header account={account} prelaunch />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <h1 className="font-sora text-3xl font-bold text-[#1C1B1B]">
          Support
        </h1>
        <p className="mt-4 text-[#5B403C]">
          Need help with an order? Check its status page for updates, or contact
          our team on WhatsApp or email.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href={SUPPORT_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="kk-shine group inline-flex items-center gap-2 rounded-full bg-kk-red px-5 py-2.5 font-inter text-[15px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(182,25,19,0.9)] transition-colors hover:bg-kk-red-deep"
          >
            Live chat on WhatsApp
          </a>
          <a
            href={SUPPORT_EMAIL_HREF}
            className="inline-flex items-center gap-2 rounded-full border border-[#E4BEB8] px-5 py-2.5 font-inter text-[15px] font-semibold text-[#5B403C] transition-colors hover:bg-white"
          >
            Email {SUPPORT_EMAIL}
          </a>
        </div>
      </div>
      <Footer />
    </main>
  );
}
