import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseClientMock } from "@/test/supabase-mock";

const state = { client: supabaseClientMock() };
const verifySession = vi.fn(() => Promise.resolve({ userId: "u1", email: null, phone: null }));
const requireActiveAccount = vi.fn(() => Promise.resolve());
vi.mock("@/lib/auth/dal", () => ({ verifySession: () => verifySession(), requireActiveAccount: () => requireActiveAccount() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => Promise.resolve(state.client) }));

const { setMessagePreferencesAction } = await import("./message-preferences");

beforeEach(() => {
  verifySession.mockReset();
  verifySession.mockResolvedValue({ userId: "u1", email: null, phone: null });
  requireActiveAccount.mockReset();
  requireActiveAccount.mockResolvedValue(undefined);
});

describe("setMessagePreferencesAction", () => {
  it("saves both choices through the signed-in user's own client", async () => {
    state.client = supabaseClientMock({ rpc: { set_message_preferences: ok(null) } });
    expect(await setMessagePreferencesAction(true, false)).toEqual({});
    expect(state.client.rpc).toHaveBeenCalledWith("set_message_preferences", { p_marketing_email: true, p_marketing_sms: false });
  });

  it("requires a session and an active account", async () => {
    state.client = supabaseClientMock({ rpc: { set_message_preferences: ok(null) } });
    verifySession.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));
    await expect(setMessagePreferencesAction(true, true)).rejects.toThrow("NEXT_REDIRECT");
    requireActiveAccount.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/"));
    await expect(setMessagePreferencesAction(true, true)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.client.rpc).not.toHaveBeenCalled();
  });

  it("returns a plain error, and logs nothing personal, when the save fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.client = supabaseClientMock({ rpc: { set_message_preferences: fail("permission denied for table message_preferences") } });
    expect((await setMessagePreferencesAction(true, true)).error).toBe("We could not save that. Please try again.");
    expect(JSON.stringify(log.mock.calls)).not.toContain("u1");
  });

  it("refuses non-boolean input", async () => {
    state.client = supabaseClientMock({ rpc: { set_message_preferences: ok(null) } });
    expect((await setMessagePreferencesAction("yes" as unknown as boolean, false)).error).toBeTruthy();
    expect(state.client.rpc).not.toHaveBeenCalled();
  });
});
