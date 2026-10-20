import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, accountLabel, auditActionLabel, roleLabel, transactionKindLabel } from "./labels";

describe("admin labels", () => {
  it("has a plain-language label for every action the admin RPCs write to the audit log", () => {
    const written = [
      "vendor.approve", "vendor.reject", "vendor.set_commission", "rider.approve", "rider.reject",
      "rider_document.approve", "rider_document.reject", "user.suspend", "user.reinstate", "user.grant_role",
      "user.revoke_role", "payout.record", "order.refund_escrow", "order.request_gateway_refund",
      "order.reset_delivery_code_attempts", "order.reassign_rider", "service_area.update",
    ];
    for (const action of written) {
      expect(AUDIT_ACTIONS).toContain(action);
      expect(auditActionLabel(action)).not.toMatch(/[._]/);
    }
  });

  it("falls back to readable words for something it does not know", () => {
    expect(auditActionLabel("thing.did_something")).toBe("Thing did something");
    expect(roleLabel("new_role")).toBe("New role");
  });

  it("names ledger accounts and transaction kinds without internal terms", () => {
    expect(accountLabel("platform:escrow")).toBe("Money held until delivery");
    expect(accountLabel("vendor:available")).toBe("Vendor's balance");
    expect(transactionKindLabel("escrow_release")).not.toMatch(/escrow/i);
    expect(roleLabel("finance")).toBe("Finance admin");
  });
});
