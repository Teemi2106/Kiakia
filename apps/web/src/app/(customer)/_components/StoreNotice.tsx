"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect } from "react";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";

/** The customer store's one toast: cart confirmations and rollback errors. */
export function StoreNotice() {
  const notice = useCustomerStore((s) => s.notice);
  const dismissNotice = useCustomerStore((s) => s.dismissNotice);

  // Keyed on the notice's id so a repeat message restarts the timer.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissNotice, 3000);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  if (!notice) return null;

  return (
    <div
      className={`fixed bottom-24 left-1/2 z-60 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-white shadow-lg ${
        notice.tone === "success" ? "bg-[#1C1B1B]" : "bg-[#BA1A1A]"
      }`}
      role="status"
    >
      {notice.tone === "success" ? (
        <CheckCircle2 className="size-4 shrink-0" />
      ) : (
        <AlertCircle className="size-4 shrink-0" />
      )}
      {notice.text}
    </div>
  );
}
