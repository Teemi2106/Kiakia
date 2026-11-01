// app/(customer)/profile/_components/MobileLegal.tsx
"use client";

import { ChevronRight, FileText } from "lucide-react";
import Link from "next/link";

const LEGAL_ITEMS = [
  {
    href: "/terms",
    label: "Terms of Service",
    icon: FileText,
  },
  {
    href: "/privacy",
    label: "Privacy Policy",
    icon: FileText,
  },
] as const;

export function MobileLegal() {
  return (
    <div>
      <div className="mb-2">
        <h3 className="font-inter text-sm font-semibold uppercase tracking-[0.7px] text-kk-cocoa">
          LEGAL
        </h3>
      </div>

      <div className="space-y-3">
        {LEGAL_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center justify-between rounded-xl border border-kk-hair bg-kk-card p-4 transition-colors hover:bg-kk-cream"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-kk-sand">
                <item.icon className="size-5 text-kk-cocoa" />
              </div>
              <span className="font-sora text-lg font-semibold text-kk-ink">
                {item.label}
              </span>
            </div>
            <ChevronRight className="size-4 text-kk-cocoa" />
          </Link>
        ))}
      </div>
    </div>
  );
}
