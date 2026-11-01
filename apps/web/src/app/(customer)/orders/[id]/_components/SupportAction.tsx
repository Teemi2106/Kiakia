// app/(customer)/orders/[id]/_components/SupportAction.tsx
"use client";

import Link from "next/link";

export function SupportAction() {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-inter text-base text-kk-cocoa">
        Need help with your order?
      </p>
      <Link
        href="/support"
        className="font-inter text-sm font-semibold text-kk-red-ink underline hover:text-kk-red-ink"
      >
        Contact support
      </Link>
    </div>
  );
}
