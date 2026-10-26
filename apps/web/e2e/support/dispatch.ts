import { formatLagosTime } from "../../src/lib/time";
import { ok, serviceClient } from "./supabase";

/**
 * Helpers for the sequential-dispatch specs (offers go to ONE rider at a time,
 * nearest first; see docs/dispatch-design.md). Everything reads ground truth
 * with the service role; nothing here drives the flow except
 * `advanceUntil`, which stands in for the scheduler only when it is late.
 */

export interface OfferRow {
  id: string;
  rider_id: string;
  status: string;
  cycle_no: number;
  attempt_no: number;
  close_reason: string | null;
  expires_at: string;
}

/** Every offer for the order, oldest ask first. */
export async function offersFor(orderId: string): Promise<OfferRow[]> {
  return ok(
    await serviceClient().from("dispatch_offers").select("id, rider_id, status, cycle_no, attempt_no, close_reason, expires_at").eq("order_id", orderId).order("attempt_no", { ascending: true }),
    "offers",
  ) as OfferRow[];
}

/** The single live ("offered") offer, or null. The database guarantees there is never more than one. */
export async function liveOffer(orderId: string): Promise<OfferRow | null> {
  const live = (await offersFor(orderId)).filter((offer) => offer.status === "offered");
  if (live.length > 1) throw new Error(`order ${orderId} has ${live.length} live offers: sequential dispatch allows at most one`);
  return live[0] ?? null;
}

export async function dispatchRow(orderId: string): Promise<{ state: string; cycle_no: number; attempt_no: number; start_at: string | null; expected_ready_at: string | null; start_basis: unknown; next_check_at: string | null } | null> {
  const { data, error } = await serviceClient().from("order_dispatch").select("state, cycle_no, attempt_no, start_at, expected_ready_at, start_basis, next_check_at").eq("order_id", orderId).maybeSingle();
  if (error) throw new Error(`order_dispatch: ${error.message}`);
  return data;
}

/** The admin UI and the vendor UI print Lagos wall-clock times; this prints the same text for a database timestamp. */
export const lagosTime = (iso: string | null): string => formatLagosTime(iso) ?? "";

/**
 * Cron dispatch-tick runs every 5 s on the e2e stack, so a lapsed offer is
 * normally advanced by itself. `check` is polled for `cronGraceMs`; if it is
 * still false after that, the scheduler is assumed late and the service role
 * calls sweep_dispatch_offers() (the wrapper over the same tick) before
 * every further poll. Returns whether the fallback was needed, so the caller can
 * record it instead of hiding it.
 */
export async function advanceUntil(check: () => Promise<boolean>, opts: { timeoutMs: number; cronGraceMs: number; pollMs?: number }): Promise<{ usedFallback: boolean }> {
  const started = Date.now();
  let usedFallback = false;
  for (;;) {
    if (await check()) return { usedFallback };
    const elapsed = Date.now() - started;
    if (elapsed > opts.timeoutMs) throw new Error(`condition not met within ${opts.timeoutMs} ms (fallback tick used: ${usedFallback})`);
    if (elapsed > opts.cronGraceMs) {
      usedFallback = true;
      ok(await serviceClient().rpc("sweep_dispatch_offers"), "sweep_dispatch_offers (scheduler stand-in)");
    }
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 1_000));
  }
}

export async function setDispatchSettingAs(adminId: string, key: string, value: number): Promise<void> {
  ok(await serviceClient().rpc("admin_set_dispatch_setting", { p_key: key, p_value: value, p_reason: "e2e setup", p_actor_id: adminId }), `set ${key}`);
}

/**
 * The stack outlives a run, and the dispatch-tick cron keeps retrying every order that is still waiting for a
 * rider, so an order a failed earlier run left in the kitchen would be offered to THIS run's riders (and a
 * rider holding a live offer elsewhere is skipped for the order under test). Cancel every unassigned order
 * still in dispatch, except the ones named, before riders go online. Service role, throwaway stack only.
 */
export async function retireStaleDispatchOrders(keepOrderIds: readonly string[] = []): Promise<number> {
  const svc = serviceClient();
  const stale = ok(await svc.from("orders").select("id").in("status", ["accepted", "preparing", "ready_for_pickup"]).is("rider_id", null), "stale orders") as Array<{ id: string }>;
  const ids = stale.map((row) => row.id).filter((id) => !keepOrderIds.includes(id));
  if (ids.length > 0) ok(await svc.from("orders").update({ status: "cancelled_by_platform" }).in("id", ids), "retire stale orders");
  return ids.length;
}
