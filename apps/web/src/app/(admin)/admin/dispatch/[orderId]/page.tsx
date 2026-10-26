import { getDispatchHistory } from "@/lib/admin/dispatch";
import { requireAdminContext } from "@/lib/auth/dal";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatchHistory } from "../../../_components/DispatchHistory";
import { PageHeader } from "../../../_components/PageHeader";

export const metadata: Metadata = { title: "Dispatch history" };

export default async function DispatchHistoryPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireAdminContext();
  const { orderId } = await params;
  const history = await getDispatchHistory(orderId);
  if (!history) notFound();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={`Dispatch history${history.orderCode ? `: order ${history.orderCode}` : ""}`}
        description="Every rider who was asked for this order, how each answered, and what the system did."
        actions={
          <span className="flex gap-4 text-sm">
            <Link href="/admin/dispatch" className="text-brand-600 hover:underline">
              Back to Waiting for a rider
            </Link>
            <Link href={`/admin/orders/${orderId}`} className="text-brand-600 hover:underline">
              Open the order
            </Link>
          </span>
        }
      />
      <DispatchHistory history={history} />
    </div>
  );
}
