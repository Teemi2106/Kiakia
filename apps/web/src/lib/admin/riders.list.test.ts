import { describe, expect, it, vi } from "vitest";
import { ok, supabaseClientMock } from "@/test/supabase-mock";

const state = { client: supabaseClientMock() };

vi.mock("@/lib/auth/dal", () => ({
  requireAdminContext: vi.fn(() => Promise.resolve({ userId: "admin" })),
  canManageFinance: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

const { listRiders, countRidersByState } = await import("./riders");

describe("listRiders", () => {
  it("passes the search, state and availability to admin_list_riders and maps the row", async () => {
    state.client = supabaseClientMock({
      rpc: {
        admin_list_riders: ok([
          {
            user_id: "r1",
            full_name: "Tunde",
            phone: "0802",
            vehicle_type: "bike",
            plate_number: "ABC-123",
            kyc_status: "approved",
            state: "suspended",
            is_online: false,
            rating_avg: 4.5,
            rating_count: 10,
            last_ping_at: null,
            documents_pending: 2,
            created_at: "2026-01-01T00:00:00Z",
            total_count: 7,
          },
        ]),
      },
    });

    const page = await listRiders({ q: " Tunde ", state: "suspended", availability: "offline", page: 2, pageSize: 5 });

    expect(state.client.rpc).toHaveBeenCalledWith("admin_list_riders", {
      p_q: "Tunde",
      p_state: "suspended",
      p_availability: "offline",
      p_limit: 5,
      p_offset: 5,
    });
    expect(page.total).toBe(7);
    expect(page.rows[0]).toMatchObject({ userId: "r1", fullName: "Tunde", state: "suspended", kycStatus: "approved", documentsPending: 2 });
  });

  it("treats an unknown state or availability as no filter", async () => {
    state.client = supabaseClientMock({ rpc: { admin_list_riders: ok([]) } });

    await listRiders({ state: "deleted", availability: "maybe" });

    expect(state.client.rpc).toHaveBeenCalledWith("admin_list_riders", { p_q: null, p_state: null, p_availability: null, p_limit: 25, p_offset: 0 });
  });
});

describe("countRidersByState", () => {
  it("fills in zero for a state nobody is in", async () => {
    state.client = supabaseClientMock({
      rpc: {
        admin_rider_state_counts: ok([
          { state: "pending", total: 4 },
          { state: "active", total: 9 },
        ]),
      },
    });

    expect(await countRidersByState()).toEqual({ pending: 4, active: 9, rejected: 0, suspended: 0, deleted: 0 });
  });
});
