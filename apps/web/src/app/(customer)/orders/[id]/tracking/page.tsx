// app/(customer)/orders/[id]/tracking/page.tsx
import type { Metadata } from "next";
import { TrackingDesktop } from "./_components/TrackingDesktop";
import { TrackingMobile } from "./_components/TrackingMobile";
import type { TimelineStep, Driver, Vendor } from "./_components/types";

export const metadata: Metadata = { title: "Live Tracking" };

// Demo data (will be replaced with real data later)
const DEMO_STEPS: TimelineStep[] = [
  { id: "1", label: "Order Confirmed", time: "7:10 PM", status: "done" },
  { id: "2", label: "Preparing Food", time: "7:15 PM", status: "done" },
  { id: "3", label: "Rider on the way", time: "7:33 PM", status: "done" },
  { id: "4", label: "Delivered", time: "7:45 PM", status: "done" },
];

const DEMO_DRIVER: Driver = {
  name: "Michael O.",
  rating: 4.8,
  plateNumber: "AAA-1234",
  avatarUrl: undefined,
};

const DEMO_VENDOR: Vendor = {
  name: "Burger Joint Downtown",
  itemCount: 3,
  logoUrl: undefined,
};

interface TrackingPageProps {
  params: Promise<{ id: string }>;
}

export default async function TrackingPage({ params }: TrackingPageProps) {
  const { id } = await params;

  return (
    <>
      <div className="hidden lg:block">
        <TrackingDesktop
          steps={DEMO_STEPS}
          driver={DEMO_DRIVER}
          vendor={DEMO_VENDOR}
          orderId={id} // ← Pass the order ID here
        />
      </div>
      <div className="lg:hidden">
        <TrackingMobile
          steps={DEMO_STEPS}
          driver={DEMO_DRIVER}
          vendor={DEMO_VENDOR}
          orderId={id} // ← Pass the order ID here
        />
      </div>
    </>
  );
}
