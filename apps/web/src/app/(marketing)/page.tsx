// app/page.tsx
import { Metadata } from "next";
import { Header } from "./_components/Header";
import { Hero } from "./_components/Hero";
import { HowItWorks } from "./_components/HowItWorks";
import { EscrowSection } from "./_components/EscrowSection";
import { Footer } from "./_components/Footer";

export const metadata: Metadata = {
  title: "Fast. Fresh. Reliable.",
  description:
    "The most trusted way to get your favorite local meals delivered.",
  openGraph: {
    title: "KiaKia - Fast. Fresh. Reliable.",
    description:
      "The most trusted way to get your favorite local meals delivered.",
    images: ["/assets/hero-banner.png"],
  },
};

export default function MarketingHome() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <Header />
      <Hero />
      <HowItWorks />
      <EscrowSection />
      <Footer />
    </main>
  );
}
