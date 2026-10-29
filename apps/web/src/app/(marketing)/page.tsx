// app/(marketing)/page.tsx
//
// The one genuinely public, Supabase-light route in the app: everything below
// renders on the server with no client data fetching, and the only session
// read is getMarketingAccount() for the header. Keep it that way — load/
// marketing-page.js leans on this route being cheap to serve.
//
// Running order is deliberate: appetite first (Hero, Marquee, Cravings),
// then the reason to believe it will be quick (Speed, HowItWorks), and only
// then a slim Assurance band. Trust is a footnote to hunger here, not the
// pitch — a visitor arrives wanting dinner, not a payments explainer.
import type { Metadata } from "next";
import { getMarketingAccount } from "@/lib/auth/marketing-account";
import { Header } from "./_components/Header";
import { Hero } from "./_components/Hero";
import { Marquee } from "./_components/Marquee";
import { Cravings } from "./_components/Cravings";
import { Speed } from "./_components/Speed";
import { HowItWorks } from "./_components/HowItWorks";
import { Assurance } from "./_components/Assurance";
import { Personas } from "./_components/Personas";
import { Faq } from "./_components/Faq";
import { FinalCta } from "./_components/FinalCta";
import { Footer } from "./_components/Footer";

const DESCRIPTION =
  "Jollof, suya, shawarma, amala and more, from kitchens on your own street, at your door in under 30 minutes. Order on KiaKia and watch your rider the whole way.";

export const metadata: Metadata = {
  title: "Fast. Fresh. Reliable.",
  description: DESCRIPTION,
  openGraph: {
    title: "KiaKia | Fast. Fresh. Reliable.",
    description: DESCRIPTION,
    images: ["/assets/hero-banner.png"],
  },
};

export default async function MarketingHome() {
  const account = await getMarketingAccount();

  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header account={account} />
      <Hero account={account} />
      <Marquee />
      <Cravings />
      <Speed />
      <HowItWorks />
      <Assurance />
      <Personas />
      <Faq />
      <FinalCta account={account} />
      <Footer />
    </main>
  );
}
