import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";
import { loadDeliveryInfo } from "./delivery-info";

function clientFor(deliveryBy: Record<string, "rider" | "vendor">, state: unknown) {
  return supabaseClientMock({
    from: { orders: queryBuilder(ok(Object.entries(deliveryBy).map(([id, delivery_by]) => ({ id, delivery_by })))) },
    rpc: { vendor_dispatch_state: ok(state) },
  });
}

// The mock only implements the two calls the loader makes (as in the other action tests).
const asLoaderClient = (client: ReturnType<typeof clientFor>): never => client as never;

describe("loadDeliveryInfo", () => {
  it("returns nothing for no orders and makes no call", async () => {
    const client = clientFor({}, {});
    expect((await loadDeliveryInfo(asLoaderClient(client), [])).size).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("asks for the dispatch state of rider orders not yet picked up, including ones with a rider already", async () => {
    const client = clientFor({ a: "rider", b: "rider", c: "rider" }, { state: "rider_assigned", assigned_eta_at: "2026-10-25T15:06:00Z" });
    const info = await loadDeliveryInfo(asLoaderClient(client), [
      { id: "a", status: "preparing" },
      { id: "b", status: "rider_assigned" },
      { id: "c", status: "picked_up" },
    ]);
    expect(info.get("a")?.dispatch?.state).toBe("rider_assigned");
    expect(info.get("b")?.dispatch?.assignedEtaAt).toBe("2026-10-25T15:06:00Z");
    expect(info.get("c")?.dispatch).toBeNull();
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("never asks for the dispatch state of an order the store delivers itself", async () => {
    const client = clientFor({ a: "vendor" }, { state: "self_delivery" });
    const info = await loadDeliveryInfo(asLoaderClient(client), [{ id: "a", status: "ready_for_pickup" }]);
    expect(info.get("a")).toEqual({ deliveryBy: "vendor", dispatch: null });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("shows no dispatch state when the read fails", async () => {
    const client = supabaseClientMock({
      from: { orders: queryBuilder(ok([{ id: "a", delivery_by: "rider" }])) },
      rpc: { vendor_dispatch_state: { data: null, error: { message: "boom" } } },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const info = await loadDeliveryInfo(asLoaderClient(client), [{ id: "a", status: "ready_for_pickup" }]);
    expect(info.get("a")).toEqual({ deliveryBy: "rider", dispatch: null });
  });
});
