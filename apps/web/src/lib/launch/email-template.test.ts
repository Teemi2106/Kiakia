import { describe, expect, it } from "vitest";
import {
  buildLaunchEmail,
  createLaunchDeliveryToken,
  hashLaunchDeliveryToken,
  KIAKIA_PRODUCTION_URL,
} from "../../../../../supabase/functions/_shared/launch-email";
import {
  buildEmail,
  loadConfig,
  sendEmailViaResend,
  type OutboxRow,
} from "../../../../../supabase/functions/_shared/messaging";

describe("pre-launch email templates", () => {
  const unsubscribeUrl = `${KIAKIA_PRODUCTION_URL}/launch/unsubscribe?token=abc123`;

  it("renders the custom welcome ticket with safe inline HTML and a working opt-out", () => {
    const email = buildLaunchEmail("welcome", unsubscribeUrl);

    expect(email.subject).toBe("You're on the list! 🍔 KiaKia is cooking...");
    expect(email.html).toContain("Hey foodie!");
    expect(email.html).toContain("first-to-know list");
    expect(email.html).toContain("KK-FIRST-001");
    expect(email.html).toContain("P.S.");
    expect(email.html).toContain("KiaKia burger with fries");
    expect(email.html).toContain("style=\"");
    expect(email.html).toContain("name=\"viewport\"");
    expect(email.html).toContain("width:100%");
    expect(email.html).toContain(`href=\"${unsubscribeUrl}\"`);
    expect(email.text).toContain("Good food is coming. Fast fast!");
    expect(email.text).toContain("what should I eat first?");
  });

  it("sends launch subscribers to the configured production app", () => {
    const email = buildLaunchEmail("announcement", unsubscribeUrl);

    expect(email.subject).toContain("We're open");
    expect(email.html).toContain("EXPLORE KIAKIA");
    expect(email.html).toContain(`href=\"${KIAKIA_PRODUCTION_URL}/home\"`);
    expect(email.text).toContain(`${KIAKIA_PRODUCTION_URL}/home`);
    expect(email.html).toContain(`href=\"${unsubscribeUrl}\"`);
  });

  it("escapes unsafe unsubscribe URL characters and rejects non-HTTPS URLs", () => {
    const email = buildLaunchEmail("welcome", `${KIAKIA_PRODUCTION_URL}/unsubscribe?a=1&b=2`);
    expect(email.html).toContain("a=1&amp;b=2");
    expect(() => buildLaunchEmail("welcome", "javascript:alert(1)")).toThrow("HTTPS");
  });

  it("reuses the same unsubscribe token on retries without storing the raw token", async () => {
    const first = await createLaunchDeliveryToken("worker-secret", "outbox-1", "subscriber-1");
    const retry = await createLaunchDeliveryToken("worker-secret", "outbox-1", "subscriber-1");
    const anotherMessage = await createLaunchDeliveryToken("worker-secret", "outbox-2", "subscriber-1");

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(retry).toBe(first);
    expect(anotherMessage).not.toBe(first);
    expect(await hashLaunchDeliveryToken(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("retries transient Resend failures with the same outbox idempotency key", async () => {
    const cfg = loadConfig((name) => ({
      RESEND_API_KEY: "test-resend-key",
      MESSAGE_FROM_EMAIL: "KiaKia <hello@kiakia.ng>",
      MESSAGE_UNSUBSCRIBE_SECRET: "test-unsubscribe-secret",
      MESSAGE_PROVIDER_MODE: "live",
    } as Record<string, string>)[name]);
    const row: OutboxRow = {
      id: "launch-outbox-1",
      channel: "email",
      category: "promotional",
      kind: "launch_announcement",
      recipient_user_id: null,
      to_address: "test-recipient@example.com",
      subject: "Launch",
      body: "The kitchen is open.",
      attempts: 1,
    };
    const idempotencyKeys: string[] = [];
    const listHeaders: string[] = [];
    let attempt = 0;
    const retryFetch = async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      idempotencyKeys.push(headers["Idempotency-Key"]);
      listHeaders.push(JSON.parse(init.body as string).headers["List-Unsubscribe"]);
      attempt += 1;
      return attempt === 1
        ? new Response(JSON.stringify({ name: "rate_limit" }), { status: 503 })
        : new Response(JSON.stringify({ id: "re_launch_1" }), { status: 200 });
    };
    const oneClickUrl = `${KIAKIA_PRODUCTION_URL}/launch/unsubscribe/one-click?token=stable`;
    const first = await sendEmailViaResend(cfg, row, buildEmail({ subject: "Launch", body: row.body }), unsubscribeUrl, retryFetch, oneClickUrl);
    const second = await sendEmailViaResend(cfg, row, buildEmail({ subject: "Launch", body: row.body }), unsubscribeUrl, retryFetch, oneClickUrl);

    expect(first).toMatchObject({ ok: false, permanent: false });
    expect(second).toEqual({ ok: true, providerMessageId: "re_launch_1" });
    expect(idempotencyKeys).toEqual([row.id, row.id]);
    expect(listHeaders).toEqual([`<${oneClickUrl}>`, `<${oneClickUrl}>`]);
  });
});
