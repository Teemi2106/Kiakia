import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  InvalidOrderTransitionError,
  ORDER_STATUSES,
  type OrderStatus,
  assertOrderTransition,
  canTransitionOrder,
  isTerminalStatus,
} from "./order-state-machine";

describe("the golden path", () => {
  it("allows the full happy-path order lifecycle in order", () => {
    const path: OrderStatus[] = [
      "draft",
      "placed",
      "accepted",
      "preparing",
      "ready_for_pickup",
      "rider_assigned",
      "picked_up",
      "in_transit",
      "arrived",
      "delivered",
    ];

    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransitionOrder(path[i]!, path[i + 1]!)).toBe(true);
    }
  });
});

describe("canTransitionOrder", () => {
  it("rejects skipping states", () => {
    expect(canTransitionOrder("placed", "preparing")).toBe(false);
    expect(canTransitionOrder("draft", "delivered")).toBe(false);
  });

  it("rejects moving backwards", () => {
    expect(canTransitionOrder("preparing", "accepted")).toBe(false);
  });

  it("allows vendor rejection only directly after placement", () => {
    expect(canTransitionOrder("placed", "rejected_by_vendor")).toBe(true);
    expect(canTransitionOrder("accepted", "rejected_by_vendor")).toBe(false);
  });

  it("allows the customer free-cancellation window only at placed", () => {
    expect(canTransitionOrder("placed", "cancelled_by_customer")).toBe(true);
    expect(canTransitionOrder("accepted", "cancelled_by_customer")).toBe(false);
  });

  it("allows platform cancellation from every non-terminal state after placement", () => {
    for (const status of ORDER_STATUSES) {
      if (status === "draft" || isTerminalStatus(status)) continue;
      expect(canTransitionOrder(status, "cancelled_by_platform")).toBe(true);
    }
  });

  it("allows arrived to branch into delivered, failed_delivery, or cancelled_by_platform", () => {
    expect(ALLOWED_TRANSITIONS.arrived).toEqual(
      expect.arrayContaining(["delivered", "failed_delivery", "cancelled_by_platform"]),
    );
  });
});

describe("terminal states", () => {
  it("have no outgoing transitions", () => {
    for (const status of ORDER_STATUSES) {
      if (isTerminalStatus(status)) {
        expect(ALLOWED_TRANSITIONS[status]).toHaveLength(0);
      }
    }
  });
});

describe("assertOrderTransition", () => {
  it("throws InvalidOrderTransitionError with the offending states on an illegal move", () => {
    expect(() => assertOrderTransition("delivered", "draft")).toThrow(
      InvalidOrderTransitionError,
    );
    try {
      assertOrderTransition("delivered", "draft");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidOrderTransitionError);
      expect((error as InvalidOrderTransitionError).from).toBe("delivered");
      expect((error as InvalidOrderTransitionError).to).toBe("draft");
    }
  });

  it("does not throw on a legal move", () => {
    expect(() => assertOrderTransition("draft", "placed")).not.toThrow();
  });
});

describe("ORDER_STATUSES coverage", () => {
  it("every status has an entry in ALLOWED_TRANSITIONS", () => {
    for (const status of ORDER_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    }
  });
});
