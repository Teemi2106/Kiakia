// app/(marketing)/page.tsx
//
// Keep the public marketing content available while app-entry actions show
// Coming soon.
//
// Running order is deliberate: appetite first (Hero, Marquee, Cravings),
// then the delivery journey (HowItWorks), followed by a slim Assurance band.
// Trust is a footnote to hunger here, not the
// pitch — a visitor arrives wanting dinner, not a payments explainer.
import type { Metadata } from "next";
import { Header } from "./_components/Header";
import { Hero } from "./_components/Hero";
import { Marquee } from "./_components/Marquee";
import { Cravings } from "./_components/Cravings";
import { HowItWorks } from "./_components/HowItWorks";
import { Assurance } from "./_components/Assurance";
import { Faq } from "./_components/Faq";
import { FinalCta } from "./_components/FinalCta";
import { Footer } from "./_components/Footer";

const DESCRIPTION =
  "Jollof, suya, shawarma, amala and more, from kitchens on your own street, at your door in under 30 minutes. Order on KiaKia and watch your rider the whole way.";

export const metadata: Metadata = {
  title: "Fast. Fresh. Reliable.",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: "KiaKia | Fast. Fresh. Reliable.",
    description: DESCRIPTION,
    images: ["/assets/hero-banner.png"],
  },
};

export default function MarketingHome() {
  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header />
      <Hero />
      <Marquee />
      <Cravings />
      <HowItWorks />
      <Assurance />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}
