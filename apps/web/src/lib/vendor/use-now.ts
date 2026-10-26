"use client";

import { useEffect, useState } from "react";

/**
 * The current time in ms for minute-level text ("arriving in about 7 min"). It
 * starts from the server's reading time so the first render matches the server
 * HTML, then follows the browser clock every `tickMs`. A fresh server reading
 * (after an action or a realtime refresh) restarts it.
 */
export function useNowMs(asOfMs: number, tickMs = 20_000): number {
  const [now, setNow] = useState(asOfMs);
  const [seen, setSeen] = useState(asOfMs);
  if (seen !== asOfMs) {
    setSeen(asOfMs);
    setNow(asOfMs);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [tickMs]);

  return now;
}
