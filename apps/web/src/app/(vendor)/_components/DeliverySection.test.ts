import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseDispatchState } from "@/lib/vendor/self-delivery";

vi.mock("@/app/actions/vendor-delivery", () => ({
  expandRiderSearchAction: vi.fn(),
  startSelfDeliveryAction: vi.fn(),
  advanceSelfDeliveryAction: vi.fn(),
  completeSelfDeliveryAction: vi.fn(),
  updatePrepEstimateAction: vi.fn(),
}));

const { DeliverySection } = await import("./DeliverySection");

const AS_OF = Date.parse("2026-10-25T15:00:00Z");

function render(status: string, dispatchFields: Record<string, unknown> | null, deliveryBy: "rider" | "vendor" = "rider") {
  const dispatch = dispatchFields ? parseDispatchState(dispatchFields, AS_OF) : null;
  return renderToStaticMarkup(createElement(DeliverySection, { orderId: "o1", status, deliveryBy, dispatch, deliveryFeeKobo: 50_000 }));
}

describe("DeliverySection (server-rendered markup)", () => {
  it("shows the no-rider choice with both actions, and the expand button only when the server allows it", () => {
    const html = render("ready_for_pickup", { state: "no_rider_nearby", can_expand: true, store_radius_m: 20_000, dispatch_state: "needs_attention" });
    expect(html).toContain("No rider is near you right now.");
    expect(html).toContain("Look further away (up to 20 km)");
    expect(html).toContain("I&#x27;ll deliver it myself");
    expect(render("ready_for_pickup", { state: "no_rider_nearby", can_expand: false })).not.toContain("Look further away (");
  });

  it("keeps the countdown on the expand button while it is rate-limited", () => {
    const html = render("ready_for_pickup", { state: "no_rider_nearby", can_expand: false, expand_available_in_seconds: 65, store_radius_m: 20_000 });
    expect(html).toContain("Look further away (try again in 1:05)");
  });

  it("says riders are asked one at a time while searching, and offers 'Need more time?' for food in the making", () => {
    const html = render("preparing", { state: "offers_pending", dispatch_state: "offered", start_at: "2026-10-25T14:50:00Z", expected_ready_at: "2026-10-25T15:20:00Z" });
    expect(html).toContain("Finding a rider: asking riders one at a time, nearest first.");
    expect(html).toContain("Food expected ready at 16:20");
    expect(html).toContain("Need more time?");
  });

  it("shows when the food is expected and when the search starts while scheduled", () => {
    const html = render("accepted", { state: "offers_pending", dispatch_state: "scheduled", start_at: "2026-10-25T15:12:00Z", expected_ready_at: "2026-10-25T15:30:00Z" });
    expect(html).toContain("Food expected ready at 16:30");
    expect(html).toContain("Rider search starts around 16:12");
    expect(html).not.toContain("Finding a rider");
    expect(html).not.toContain("Look further away");
  });

  it("shows the rider's arrival once assigned, with no prep control once the food is ready", () => {
    const html = render("rider_assigned", { state: "rider_assigned", dispatch_state: "assigned", assigned_eta_at: "2026-10-25T15:07:00Z" });
    expect(html).toContain("Rider arriving in about 7 min");
    expect(html).not.toContain("Need more time?");
  });

  it("offers 'Need more time?' on a scheduled order, but not when the store delivers", () => {
    expect(render("accepted", { state: "offers_pending", dispatch_state: "scheduled" })).toContain("Need more time?");
    expect(render("accepted", { state: "self_delivery" }, "vendor")).not.toContain("Need more time?");
  });

  it("shows nothing without a dispatch state, and the store's own steps when it delivers", () => {
    expect(render("accepted", null)).toBe("");
    expect(render("ready_for_pickup", null, "vendor")).toContain("You are delivering this order");
  });
});
