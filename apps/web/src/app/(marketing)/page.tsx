import type { Metadata } from "next";
import { getMarketingAccount } from "@/lib/auth/marketing-account";
import { countdownUntil } from "@/lib/launch/countdown";
import { LAUNCH_AT_ISO, formatLaunchDate } from "@/lib/launch/config";
import { Footer } from "./_components/Footer";
import { Header } from "./_components/Header";
import { PrelaunchExperience } from "./_components/PrelaunchExperience";

const DESCRIPTION =
  "KiaKia is getting ready to serve Lagos. Get a launch alert and be among the first to order.";

export const metadata: Metadata = {
  title: "KiaKia is getting ready to serve",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: "KiaKia | Getting ready to serve",
    description: DESCRIPTION,
    images: ["/assets/kitchen-ticket-premium.png"],
  },
};

export default async function MarketingHome() {
  const account = await getMarketingAccount();
  const now = Date.now();

  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header account={account} prelaunch />
      <PrelaunchExperience
        launchAt={LAUNCH_AT_ISO}
        launchDate={formatLaunchDate()}
        initialCountdown={countdownUntil(Date.parse(LAUNCH_AT_ISO), now)}
      />
      <Footer prelaunch />
    </main>
  );
}
