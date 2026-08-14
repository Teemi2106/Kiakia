// app/(customer)/orders/[id]/_components/SupportAction.tsx
"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";

export function SupportAction() {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-inter text-base text-[#5B403C]">
        Need help with your order?
      </p>
      <Link
        href="/support"
        className="font-inter text-sm font-semibold text-[#B61913] underline hover:text-[#9e1611]"
      >
        Contact support
      </Link>
    </div>
  );
}
