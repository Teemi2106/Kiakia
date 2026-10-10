"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { logCustomerEventAction } from "@/app/actions/events";

/** A recommendation card link that logs a recommendation_click fire-and-forget
 * on click; navigation is never awaited on or blocked by the log call. */
export function RecommendationLink({
  href,
  menuItemId,
  className,
  children,
}: {
  href: string;
  menuItemId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        try {
          void logCustomerEventAction({ eventType: "recommendation_click", menuItemId }).catch(() => {});
        } catch {
          // analytics must never block navigation
        }
      }}
    >
      {children}
    </Link>
  );
}
