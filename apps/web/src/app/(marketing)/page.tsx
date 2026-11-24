import type { Metadata } from "next";
import { getMarketingAccount } from "@/lib/auth/marketing-account";
import { countdownUntil } from "@/lib/launch/countdown";
import { LAUNCH_AT_ISO, formatLaunchDate } from "@/lib/launch/config";
import { Assurance } from "./_components/Assurance";
import { Cravings } from "./_components/Cravings";
import { Faq } from "./_components/Faq";
import { FinalCta } from "./_components/FinalCta";
import { Footer } from "./_components/Footer";
import { Header } from "./_components/Header";
import { Hero } from "./_components/Hero";
import { HowItWorks } from "./_components/HowItWorks";
import { LaunchCountdown, LaunchSignup } from "./_components/LaunchExperience";
import { Marquee } from "./_components/Marquee";

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

export default async function MarketingHome() {
  const account = await getMarketingAccount();
  const now = Date.now();

  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header account={account} />
      <Hero />
      <LaunchCountdown
        launchAt={LAUNCH_AT_ISO}
        launchDate={formatLaunchDate()}
        initialCountdown={countdownUntil(Date.parse(LAUNCH_AT_ISO), now)}
      />
      <Marquee />
      <Cravings />
      <HowItWorks />
      <Assurance />
      <Faq />
      <LaunchSignup />
      <FinalCta />
      <Footer />
    </main>
  );
}
