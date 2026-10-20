import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder, supabaseClientMock } from "@/test/supabase-mock";

const state = { client: supabaseClientMock() };

vi.mock("@/lib/auth/dal", () => ({ requireAdminContext: vi.fn(() => Promise.resolve({ userId: "admin" })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { listAuditLog } = await import("./audit");

const entry = (id: string, action: string, targetType: string, targetId: string) => ({
  id,
  actor_id: "admin-1",
  action,
  target_type: targetType,
  target_id: targetId,
  reason: null,
  details: {},
  created_at: "2026-03-01T00:00:00Z",
});

describe("listAuditLog target names", () => {
  it("resolves who or what each action was done to, so the page can say it in words", async () => {
    state.client = supabaseClientMock({
      from: {
        admin_audit_log: queryBuilder(
          ok([
            entry("1", "vendor.approve", "vendor", "v1"),
            entry("2", "order.refund_escrow", "order", "o1"),
            entry("3", "user.suspend", "user", "u1"),
            entry("4", "service_area.update", "service_area", "s1"),
          ]),
        ),
        profiles: queryBuilder(
          ok([
            { id: "admin-1", full_name: "Ngozi Admin", phone: null, status: "active" },
            { id: "u1", full_name: "Ada Obi", phone: null, status: "active" },
          ]),
        ),
        vendors: queryBuilder(ok([{ id: "v1", name: "Mama Put" }])),
        orders: queryBuilder(ok([{ id: "o1", code: "KK-1042" }])),
      },
    });

    const log = await listAuditLog();

    expect(log.rows.map((row) => [row.actorName, row.targetName])).toEqual([
      ["Ngozi Admin", "Mama Put"],
      ["Ngozi Admin", "KK-1042"],
      ["Ngozi Admin", "Ada Obi"],
      ["Ngozi Admin", null],
    ]);
  });
});
