"use client";

import { useEffect, useRef } from "react";
import { logCustomerEventAction } from "@/app/actions/events";
import type { CustomerEventInput } from "@/lib/validation/events";

/**
 * Fires one behavioural event when it mounts on the client, then renders
 * nothing. Logging from the client (not during server render) means a Link
 * prefetch of the page can never record a phantom view/search. Best-effort:
 * errors are swallowed and the UI is never affected.
 */
export function TrackEvent(props: CustomerEventInput) {
  const { eventType, vendorId, menuItemId, searchQuery } = props;
  const firedKey = useRef<string | null>(null);

  useEffect(() => {
    // Guards React strict-mode's double effect; a changed payload (e.g. a new
    // search term on the same mounted page) is a new event and does fire.
    const key = JSON.stringify([eventType, vendorId, menuItemId, searchQuery]);
    if (firedKey.current === key) return;
    firedKey.current = key;

    try {
      void logCustomerEventAction({ eventType, vendorId, menuItemId, searchQuery }).catch(() => {});
    } catch {
      // analytics must never affect the page
    }
  }, [eventType, vendorId, menuItemId, searchQuery]);

  return null;
}
