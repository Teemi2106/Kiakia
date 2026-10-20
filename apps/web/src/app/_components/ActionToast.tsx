"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect } from "react";

/**
 * A single transient message for surfaces that have no store of their own to
 * hang a notice on (the customer store's StoreNotice covers the cart). Used to
 * report a rolled-back optimistic update: the UI already flipped, the write
 * failed, the UI flipped back, and this says why. Controlled by the caller;
 * `message` of null renders nothing.
 */
export function ActionToast({
  message,
  onDismiss,
  tone = "error",
}: {
  message: string | null;
  onDismiss: () => void;
  tone?: "error" | "success";
}) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`fixed bottom-24 left-1/2 z-60 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-white shadow-lg sm:bottom-6 ${
        tone === "success" ? "bg-[#1C1B1B]" : "bg-[#BA1A1A]"
      }`}
    >
      {tone === "success" ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertCircle className="size-4 shrink-0" />}
      {message}
    </div>
  );
}
