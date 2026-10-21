"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-reads the server page every `everyMs` while the tab is visible. Renders
 * nothing; mount it only while there is something worth watching so it stops by
 * itself when the list empties. One server re-render per tick, no polling API.
 */
export function AutoRefresh({ everyMs = 15_000 }: { everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs]);

  return null;
}
