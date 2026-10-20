// app/(customer)/cart/_components/CartPageView.tsx
"use client";

import { EmptyState, buttonVariants } from "@kiakia/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { CartPanels } from "./CartPanels";

/**
 * The /cart page. It renders from the customer store the layout already
 * hydrated, so it costs no query of its own and a +/- tap is instant;
 * reusing CartPanels keeps it in visual sync with the drawer.
 */
export function CartPageView() {
  const router = useRouter();
  const isEmpty = useCustomerStore((s) => s.lines.length === 0);

  if (isEmpty) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-7xl flex-1 items-center justify-center px-4 py-12">
        <EmptyState
          title="Your cart is empty"
          description="Browse vendors and add something to get started."
          action={
            <Link href="/home" className={buttonVariants({ variant: "primary" })}>
              Browse vendors
            </Link>
          }
        />
      </div>
    );
  }

  return <CartPanels onClose={() => router.push("/home")} />;
}
