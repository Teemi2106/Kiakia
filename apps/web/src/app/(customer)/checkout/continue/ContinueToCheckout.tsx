"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";

export function ContinueToCheckout() {
  const router = useRouter();
  const merged = useCustomerStore((s) => s.guestMerged);
  const pendingWrites = useCustomerStore((s) => s.pendingWrites);

  useEffect(() => {
    if (merged && pendingWrites === 0) router.replace("/checkout");
  }, [merged, pendingWrites, router]);

  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center"
    >
      <Loader2 className="size-7 animate-spin text-kk-red" aria-hidden="true" />
      <p className="font-inter text-sm text-kk-cocoa">Getting your order ready…</p>
    </div>
  );
}
