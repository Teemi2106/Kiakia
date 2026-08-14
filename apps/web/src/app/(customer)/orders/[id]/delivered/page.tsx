// app/(customer)/orders/[id]/delivered/page.tsx
import type { Metadata } from "next";
import { DeliveredDesktop } from "./_components/DeliveredDesktop";
import { DeliveredMobile } from "./_components/DeliveredMobile";
import type { Driver } from "./_components/types";

export const metadata: Metadata = { title: "Order Delivered" };

// Demo data
const DEMO_DRIVER: Driver = {
  name: "Chidi O.",
  vehicle: "Honda CG110",
  plateNumber: "APP-456-XY",
  avatarUrl: undefined,
};

const DEMO_DELIVERY_CODE = "4091";

interface DeliveredPageProps {
  params: Promise<{ id: string }>;
}

export default async function DeliveredPage({ params }: DeliveredPageProps) {
  const { id } = await params;

  // Later, you'll use this id to fetch real delivery data:
  // const orderId = id;
  // const data = await fetchDeliveryData(orderId);

  return (
    <>
      <div className="hidden md:block">
        <DeliveredDesktop
          driver={DEMO_DRIVER}
          deliveryCode={DEMO_DELIVERY_CODE}
        />
      </div>
      <div className="md:hidden">
        <DeliveredMobile
          driver={DEMO_DRIVER}
          deliveryCode={DEMO_DELIVERY_CODE}
        />
      </div>
    </>
  );
}
