"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_MS = 10_000;

/**
 * While a message is still going out, re-reads the page every 10 seconds so the
 * counts move. Renders nothing; mounted only while some messages are waiting,
 * so it stops by itself the moment the server says everything has settled.
 * Pauses while the tab is hidden. One re-render of the server page per tick,
 * no polling API of its own.
 */
export function BroadcastAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  return null;
}
