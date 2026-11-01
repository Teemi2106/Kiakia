// app/(customer)/profile/_components/MobileHelp.tsx
"use client";

import { ChevronRight, MessageSquare } from "lucide-react";
import Link from "next/link";

// "Help Center" (browsable articles) was removed — there's no help-article
// content in this release, and a link to a non-existent page is worse than
// no link at all. /support exists as a minimal, honest placeholder.
const HELP_ITEMS = [
  {
    href: "/support",
    label: "Contact Support",
    description: "Get help with your orders",
    icon: MessageSquare,
  },
] as const;

export function MobileHelp() {
  return (
    <div>
      <div className="mb-2">
        <h3 className="font-inter text-sm font-semibold uppercase tracking-[0.7px] text-kk-cocoa">
          HELP & SUPPORT
        </h3>
      </div>

      <div className="space-y-3">
        {HELP_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center justify-between rounded-xl border border-kk-hair bg-kk-card p-4 transition-colors hover:bg-kk-cream"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-kk-sand">
                <item.icon className="size-5 text-kk-orange-ink" />
              </div>
              <div>
                <span className="font-sora text-lg font-semibold text-kk-ink">
                  {item.label}
                </span>
                <p className="font-inter text-sm text-kk-cocoa">
                  {item.description}
                </p>
              </div>
            </div>
            <ChevronRight className="size-4 text-kk-cocoa" />
          </Link>
        ))}
      </div>
    </div>
  );
}
