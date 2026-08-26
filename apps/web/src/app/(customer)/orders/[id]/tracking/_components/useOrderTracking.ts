// app/(customer)/orders/[id]/tracking/_components/useOrderTracking.ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isTerminalStatus, type OrderStatus } from "@kiakia/domain";
import type { Database } from "@kiakia/db";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface OrderTrackingState {
  /** True only until the initial get_order_tracking() call settles. */
  loading: boolean;
  /** The initial RPC call failed (order not found / not authorized / network) — the
   * map degrades to a neutral panel, it never throws past this hook. */
  error: boolean;
  status: OrderStatus | null;
  vendor: LatLng | null;
  destination: LatLng | null;
  rider: LatLng | null;
  /**
   * Only meaningful once a Realtime subscription has actually been opened
   * (stays "connecting" forever for a terminal order — see the effect
   * below, which never opens one). "connecting" covers both the initial
   * handshake and a since-recovered reconnect, so the map's own "reconnecting"
   * hint only ever shows for a genuine drop ("disconnected"), never flashes
   * during the ordinary first-connect moment.
   */
  realtimeStatus: "connecting" | "connected" | "disconnected";
}

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type RiderLocationRow = Database["public"]["Tables"]["order_rider_locations"]["Row"];
type GetOrderTrackingRow = Database["public"]["Functions"]["get_order_tracking"]["Returns"];

function toLatLng(lat: number | null, lng: number | null): LatLng | null {
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

const INITIAL_STATE: OrderTrackingState = {
  loading: true,
  error: false,
  status: null,
  vendor: null,
  destination: null,
  rider: null,
  realtimeStatus: "connecting",
};

/**
 * Loads the tracking map's initial snapshot via get_order_tracking()
 * (supabase/migrations/0027_order_tracking.sql) and then keeps it live over
 * Supabase Realtime on `orders` + `order_rider_locations`
 * (0026_rider_self_service.sql). Dispatch (0019/0023/0026/0028) is fully
 * built, so a live rider position is an expected, real state here — not a
 * "phase 3, not built yet" placeholder.
 *
 * A terminal order (delivered/cancelled/rejected/failed) never opens a
 * Realtime channel at all: 0026's own trigger already deleted its
 * order_rider_locations row and the order will never transition again, so
 * there is nothing left to subscribe to.
 */
export function useOrderTracking(orderId: string | undefined): OrderTrackingState {
  const [state, setState] = useState<OrderTrackingState>(INITIAL_STATE);

  useEffect(() => {
    // Note: this hook is only ever mounted under a fixed `orders/[id]/tracking`
    // route param, so `orderId` changing without a full remount isn't a real
    // path — no reset-to-INITIAL_STATE call here. Every setState call below
    // (including the `!orderId` guard) lives inside the async `run()`
    // function, never directly in this synchronous effect body — matching
    // CartProvider.tsx's own effect shape, since react-hooks/set-state-in-effect
    // flags a setState call made synchronously in an effect's own body.
    let cancelled = false;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function run() {
      if (!orderId) {
        setState((s) => ({ ...s, loading: false, error: true }));
        return;
      }

      const { data: rawData, error } = await supabase
        .rpc("get_order_tracking", { p_order_id: orderId })
        .single();

      // postgrest-js's `.single()` narrows via `Result extends (infer R)[] ?
      // R : never` — but generated.ts models get_order_tracking's Returns as
      // a plain object rather than a `[]` + SetofOptions (it IS present in
      // generated.ts, just not shaped for that generic), so the chain above
      // types as `never`. The runtime response is correct (`.single()` is
      // still required for PostgREST to unwrap the table-returning function
      // to one row, not an array) — only the static type needs a cast back
      // to the function's own declared Returns shape, which is what's cast
      // to here rather than a hand-duplicated local type.
      const data = rawData as GetOrderTrackingRow | null;

      if (cancelled) return;

      if (error || !data) {
        setState((s) => ({ ...s, loading: false, error: true }));
        return;
      }

      const initialStatus = data.status as OrderStatus;

      setState((s) => ({
        ...s,
        loading: false,
        error: false,
        status: initialStatus,
        vendor: toLatLng(data.vendor_lat, data.vendor_lng),
        destination: toLatLng(data.destination_lat, data.destination_lng),
        rider: toLatLng(data.rider_lat, data.rider_lng),
      }));

      if (isTerminalStatus(initialStatus)) return;

      channel = supabase
        .channel(`order-tracking-${orderId}`)
        .on<OrderRow>(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
          (payload) => {
            const nextStatus = (payload.new as Partial<OrderRow>).status;
            if (!nextStatus) return;
            // Once the order reaches a terminal status, 0026's trigger will
            // separately delete order_rider_locations — no need to
            // pre-emptively null the rider out here, that update arrives
            // over its own subscription below.
            setState((s) => ({ ...s, status: nextStatus }));
          },
        )
        .on<RiderLocationRow>(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "order_rider_locations",
            filter: `order_id=eq.${orderId}`,
          },
          (payload) => {
            if (payload.eventType === "DELETE") {
              // The order just reached a terminal status and 0026's trigger
              // cleared this row — stop showing a rider position, not an error.
              setState((s) => ({ ...s, rider: null }));
              return;
            }
            const row = payload.new as Partial<RiderLocationRow>;
            if (typeof row.lat !== "number" || typeof row.lng !== "number") return;
            setState((s) => ({ ...s, rider: { lat: row.lat as number, lng: row.lng as number } }));
          },
        )
        .subscribe((subscribeStatus) => {
          if (cancelled) return;
          // SUBSCRIBED -> connected. TIMED_OUT/CHANNEL_ERROR/CLOSED are a genuine
          // drop -> disconnected (surfaced as "reconnecting…" by MapArea.tsx).
          // Any other transient value along the way is left as "connecting",
          // never flashed as a disconnect.
          if (subscribeStatus === "SUBSCRIBED") {
            setState((s) => ({ ...s, realtimeStatus: "connected" }));
          } else if (
            subscribeStatus === "TIMED_OUT" ||
            subscribeStatus === "CHANNEL_ERROR" ||
            subscribeStatus === "CLOSED"
          ) {
            setState((s) => ({ ...s, realtimeStatus: "disconnected" }));
          }
        });
    }

    void run();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [orderId]);

  return state;
}
