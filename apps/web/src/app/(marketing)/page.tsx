// app/(marketing)/page.tsx
//
// The one genuinely public, Supabase-light route in the app: everything below
// renders on the server with no client data fetching, and the only session
// read is getMarketingAccount() for the header. Keep it that way — load/
// marketing-page.js leans on this route being cheap to serve.
import type { Metadata } from "next";
import { getMarketingAccount } from "@/lib/auth/marketing-account";
import { Header } from "./_components/Header";
import { Hero } from "./_components/Hero";
import { Marquee } from "./_components/Marquee";
import { Speed } from "./_components/Speed";
import { HowItWorks } from "./_components/HowItWorks";
import { EscrowSection } from "./_components/EscrowSection";
import { Personas } from "./_components/Personas";
import { Faq } from "./_components/Faq";
import { FinalCta } from "./_components/FinalCta";
import { Footer } from "./_components/Footer";

const DESCRIPTION =
  "Kia kia. Order from kitchens and shops near you, track the rider live, and keep your payment in escrow until a 4-digit code at your door releases it.";

export const metadata: Metadata = {
  title: "Fast. Fresh. Reliable.",
  description: DESCRIPTION,
  openGraph: {
    title: "KiaKia — Fast. Fresh. Reliable.",
    description: DESCRIPTION,
    images: ["/assets/hero-banner.png"],
  },
};

export default async function MarketingHome() {
  const account = await getMarketingAccount();

  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header account={account} />
      <Hero />
      <Marquee />
      <Speed />
      <HowItWorks />
      <EscrowSection />
      <Personas />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}
