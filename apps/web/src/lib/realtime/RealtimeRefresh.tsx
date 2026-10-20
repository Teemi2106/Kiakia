// lib/realtime/RealtimeRefresh.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export interface RealtimeRefreshProps {
  /** The table to watch, e.g. "orders". */
  table: string;
  /** A postgres_changes filter clause, e.g. `id=eq.${orderId}` or `vendor_id=eq.${vendorId}`. */
  filter: string;
  /** Unique per mounted subscription — supabase.channel() dedupes by topic,
   * same reasoning as useOrderTracking.ts's own topic naming. */
  topic: string;
  /** Skip subscribing entirely — e.g. a terminal order that will never
   * change again has nothing left to listen for. Defaults to true. */
  enabled?: boolean;
}

/**
 * Mounted as an invisible child of a Server Component page (renders
 * nothing), this keeps that page's data fresh without the page itself
 * needing to become a Client Component or duplicate its query logic:
 * on any INSERT/UPDATE/DELETE matching `table`+`filter`, it calls
 * `router.refresh()`, which re-runs the Server Component tree with a fresh
 * read and re-renders with the current data — the exact fetch the page
 * already does on a manual reload, just triggered automatically instead of
 * requiring one.
 *
 * Deliberately simpler than useOrderTracking.ts's channel (no local state
 * to keep in sync client-side — router.refresh() re-derives everything from
 * the server on every event, so there's no "resync after reconnect" step to
 * write separately), but shares its two robustness habits:
 *
 * 1. A dropped channel is retried with backoff, so one CHANNEL_ERROR
 *    doesn't silently turn a "live" page back into a "must refresh
 *    manually" page for the rest of the session.
 * 2. Returning to a backgrounded tab re-syncs unconditionally (a suspended
 *    socket may have missed events entirely) rather than trusting the
 *    channel is still caught up.
 */
export function RealtimeRefresh({ table, filter, topic, enabled = true }: RealtimeRefreshProps): null {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;
    let hasSubscribed = false;

    function scheduleRetry() {
      if (cancelled || retryTimer) return;
      const delay = Math.min(2_000 * 2 ** retryAttempt, 30_000);
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void openChannel();
      }, delay);
    }

    async function openChannel() {
      if (cancelled) return;

      // Await removal of any stale same-topic channel — left over from a
      // StrictMode double-invoked run of this effect, or from the drop we
      // are recovering from. See useOrderTracking.ts's identical guard.
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
      if (stale) await supabase.removeChannel(stale);
      if (cancelled) return;

      channel = supabase
        .channel(topic)
        .on("postgres_changes", { event: "*", schema: "public", table, filter }, () => {
          router.refresh();
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            retryAttempt = 0;
            // Catch up only after a reconnect, when events may genuinely have
            // been missed. Doing it on the first subscribe too re-rendered
            // the whole page (layout, bootstrap and every query) a moment
            // after each load, to cover a window of a few hundred ms.
            if (hasSubscribed) router.refresh();
            hasSubscribed = true;
          } else if (status === "TIMED_OUT" || status === "CHANNEL_ERROR" || status === "CLOSED") {
            scheduleRetry();
          }
        });
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && !cancelled) router.refresh();
    }

    void openChannel();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (channel) supabase.removeChannel(channel);
    };
  }, [table, filter, topic, enabled, router]);

  return null;
}
