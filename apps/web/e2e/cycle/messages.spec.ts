import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { signUnsubscribeToken } from "../../src/lib/messaging/unsubscribe-token";
import { loginAs, loginAsAdmin } from "../fixtures";
import { assertLocalStack, cycleUsers } from "../support/cycle-env";
import { assertStackSeeded, ok, serviceClient } from "../support/supabase";

/**
 * Admin messaging, end to end against the throwaway local stack (see
 * e2e/README.md): compose -> confirm -> history -> detail, the per-person send,
 * the promotions consent toggle, and the public unsubscribe route.
 *
 * Run on its own:  pnpm --filter web e2e:cycle e2e/cycle/messages.spec.ts
 *
 * Stood in: no sending worker runs in this stack, so nothing is delivered and
 * the outbox rows stay "queued". That is what the history shows as "Sending",
 * and is enough to prove the admin side. To see delivery, serve the
 * message-worker Edge Function with MESSAGE_PROVIDER_MODE=fake (no network)
 * and call it with the service key; rows for addresses containing "bounce" fail
 * and "flaky" retry, so the failure wording on the detail page can be checked
 * too. The unsubscribe secret below is set on the Next server by
 * playwright.cycle.config.ts.
 */

const runId = cycleUsers.runId;
const UNSUBSCRIBE_SECRET = process.env.E2E_UNSUBSCRIBE_SECRET ?? "e2e-unsubscribe-secret-value";
const runDigits = String(parseInt(runId, 36) % 10_000_000).padStart(7, "0");

// Not a .test address on purpose: the database refuses to email .test/.local/.example addresses (dev domains).
const people = {
  admin: { email: `msg.admin.${runId}@e2e-cycle.dev`, fullName: `Msg Admin ${runId}`, phone: `080${runDigits}6` },
  customer: { email: `msg.customer.${runId}@e2e-cycle.dev`, fullName: `Msgcust Person ${runId}`, phone: `080${runDigits}7` },
};

const S = {} as { adminId: string; customerId: string; broadcastId: string };
const svc = () => serviceClient();

async function createUser(user: { email: string; fullName: string; phone: string }): Promise<string> {
  const created = await svc().auth.admin.createUser({
    email: user.email,
    password: cycleUsers.password,
    email_confirm: true,
    user_metadata: { full_name: user.fullName, phone: user.phone },
  });
  if (created.error || !created.data.user) throw new Error(`createUser(${user.email}): ${created.error?.message}`);
  return created.data.user.id;
}

async function prefs(userId: string): Promise<{ marketing_email: boolean; marketing_sms: boolean } | null> {
  const rows = ok(await svc().from("message_preferences").select("marketing_email, marketing_sms").eq("user_id", userId), "message_preferences");
  return rows[0] ?? null;
}

let adminCtx: BrowserContext;

async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100" });
}

test.describe.serial("admin messages", () => {
  test.beforeAll(async ({ browser }) => {
    assertLocalStack();
    await assertStackSeeded();
    S.adminId = await createUser(people.admin);
    ok(await svc().from("user_roles").insert({ user_id: S.adminId, role: "superadmin" }), "grant superadmin");
    S.customerId = await createUser(people.customer);
    adminCtx = await newContext(browser);
    const page = await adminCtx.newPage();
    await loginAsAdmin(page, people.admin.email, cycleUsers.password);
    await page.close();
  });

  test.afterAll(async () => {
    await adminCtx?.close();
  });

  test("Messages is in the admin menu and opens with the starting audience already counted", async () => {
    const page = await adminCtx.newPage();
    await page.goto("/admin");
    await page.getByRole("link", { name: "Messages" }).click();
    await expect(page).toHaveURL(/\/admin\/messages$/);
    await expect(page.getByRole("heading", { name: "Messages", level: 1 })).toBeVisible();
    // Counted on the server for the page's first render: no client fetch is needed to see it.
    await expect(page.getByText(/will get this email\./)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Message history" })).toBeVisible();
    await page.close();
  });

  test("a promotion to someone who has not agreed is counted as nobody, and cannot be sent", async () => {
    const page = await adminCtx.newPage();
    await page.goto("/admin/messages");
    await page.getByLabel("Who gets this").selectOption("user");
    await page.getByLabel("Find the person (name or phone)").fill(`Msgcust Person ${runId}`);
    await page.getByRole("button", { name: new RegExp(`Msgcust Person ${runId}`) }).click();
    await page.getByRole("radio", { name: /Promotion/ }).check();
    await expect(page.getByText(/0\s+people will get this email/)).toBeVisible();
    await expect(page.getByText(/have not agreed to promotions/).first()).toBeVisible();

    await page.getByLabel("Subject").fill("Big sale");
    await page.getByLabel("Message", { exact: true }).fill("Everything half price this weekend.");
    await page.getByLabel("Why are you sending this?").fill("Weekend sale");
    await page.getByRole("button", { name: "Review and send" }).click();
    await expect(page.getByText("Nobody would get this message")).toBeVisible();
    await page.close();
  });

  test("compose to one person, confirm, send, then find it in the history and its detail page", async () => {
    const page = await adminCtx.newPage();
    await page.goto("/admin/messages");

    await page.getByLabel("Who gets this").selectOption("user");
    await page.getByLabel("Find the person (name or phone)").fill(`Msgcust Person ${runId}`);
    await page.getByRole("button", { name: new RegExp(`Msgcust Person ${runId}`) }).click();
    await expect(page.getByText(/1\s+person will get this email/)).toBeVisible();

    await page.getByLabel("Subject").fill(`Service notice ${runId}`);
    await page.getByLabel("Message", { exact: true }).fill("Hi {{first_name}}, we are improving the app on Sunday.\nThanks for your patience.");
    // The preview shows the message for a sample person, as plain text: the field is filled in, nothing is left in braces.
    await expect(page.getByText("Hi Msgcust, we are improving the app on Sunday.")).toBeVisible();
    await expect(page.getByText("Preview for a sample person").locator("..")).not.toContainText("{{");
    await expect(page.getByText(/text segment/)).toHaveCount(0); // email: no segment counter

    // The confirmation step is the only way to send.
    await page.getByLabel("Why are you sending this?").fill("Announce Sunday maintenance");
    await page.getByLabel("Message", { exact: true }).press("Enter");
    await expect(page.getByText("cannot be undone or taken back")).toHaveCount(0);
    await page.getByRole("button", { name: "Review and send" }).click();
    await expect(page.getByText("cannot be undone or taken back")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Send this email to 1 person\?/ })).toBeVisible();

    await page.getByRole("button", { name: /Yes, send to 1 person/ }).click();
    await expect(page.getByText(/Your message is on its way/)).toBeVisible();

    await page.getByRole("link", { name: "See how it is going" }).click();
    await expect(page).toHaveURL(/\/admin\/messages\/[0-9a-f-]{36}$/);
    S.broadcastId = page.url().split("/").pop() ?? "";
    await expect(page.getByRole("heading", { name: `Service notice ${runId}` })).toBeVisible();
    await expect(page.getByText("Hi {{first_name}}, we are improving the app on Sunday.")).toBeVisible();
    await expect(page.getByText("People it was meant for")).toBeVisible();
    // No worker in this stack: still waiting, and the page says it refreshes itself.
    await expect(page.getByText(/still going out/)).toBeVisible();

    // Ground truth: one queued row for the customer, with the name filled in per person.
    const rows = ok(await svc().from("message_outbox").select("recipient_user_id, status, subject, body, category").eq("broadcast_id", S.broadcastId), "outbox");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient_user_id: S.customerId, status: "queued", category: "transactional" });
    expect(rows[0].body).toContain("Hi Msgcust, we are improving");

    // History lists it with the running counts.
    await page.goto("/admin/messages");
    const row = page.getByRole("row").filter({ hasText: `Service notice ${runId}` });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Sending \(1 to go\)/)).toBeVisible();
    await page.close();
  });

  test("the detail page explains failed deliveries in plain words, never raw provider text", async () => {
    // A failure injected the way the worker records one (service role), then read back through the page.
    const outbox = ok(await svc().from("message_outbox").select("id").eq("broadcast_id", S.broadcastId), "outbox");
    // The worker claims a row (queued -> sending) before it sends; only then can it record a failure.
    ok(await svc().rpc("message_claim_batch", { p_limit: 100 }), "claim");
    ok(await svc().rpc("message_mark_failed", { p_id: outbox[0].id, p_error: "resend_http_422:validation_error to=ada@example.com", p_permanent: true }), "mark failed");

    const page = await adminCtx.newPage();
    await page.goto(`/admin/messages/${S.broadcastId}`);
    await expect(page.getByText("Messages that did not arrive")).toBeVisible();
    await expect(page.getByRole("cell", { name: /Msgcust Person/ })).toBeVisible();
    await expect(page.getByText("The provider turned this message down")).toBeVisible();
    await expect(page.getByText("ada@example.com")).toHaveCount(0);
    await expect(page.getByText(/still going out/)).toHaveCount(0); // settled: nothing waiting, so no auto-refresh banner
    await page.close();
  });

  test("a customer's page can send one person a message and lists recent messages", async () => {
    const page = await adminCtx.newPage();
    await page.goto(`/admin/customers/${S.customerId}`);
    await expect(page.getByRole("heading", { name: "Recent messages" })).toBeVisible();
    await expect(page.getByText(`Service notice ${runId}`)).toBeVisible(); // the broadcast above is in their history

    await page.getByLabel("Subject").fill(`Your order help ${runId}`);
    await page.getByLabel("Message", { exact: true }).fill("Hello, we have looked into your question.");
    await page.getByLabel("Why are you sending this?").fill("Support follow-up");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/Message queued/)).toBeVisible();

    await page.reload();
    await expect(page.getByText(`Your order help ${runId}`)).toBeVisible();
    const audit = ok(await svc().from("admin_audit_log").select("action, target_type").eq("actor_id", S.adminId).in("action", ["message.broadcast", "message.send"]), "audit");
    expect(audit.map((a: { action: string }) => a.action).sort()).toEqual(["message.broadcast", "message.send"]);
    await page.close();
  });

  test("a customer cannot open the admin messages page", async ({ browser }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await loginAs(page, people.customer.email, cycleUsers.password);
    await page.goto("/admin/messages");
    await expect(page).toHaveURL(/\/home/);
    await ctx.close();
  });

  test("a customer's promotion choices start off, save, and survive a reload", async ({ browser }) => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await loginAs(page, people.customer.email, cycleUsers.password);
    await page.goto("/profile/settings");

    const email = page.getByRole("switch", { name: "Promotional emails" });
    const sms = page.getByRole("switch", { name: "Promotional text messages" });
    await expect(email).toHaveAttribute("aria-checked", "false");
    await expect(sms).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText(/not optional/)).toBeVisible();

    await email.click();
    await expect(email).toHaveAttribute("aria-checked", "true"); // optimistic
    await expect.poll(async () => (await prefs(S.customerId))?.marketing_email).toBe(true);

    await page.reload();
    await expect(page.getByRole("switch", { name: "Promotional emails" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Promotional text messages" })).toHaveAttribute("aria-checked", "false");
    await ctx.close();
  });

  test("the unsubscribe link: GET only asks, the button turns it off, and bad links do nothing", async ({ browser }) => {
    const token = signUnsubscribeToken(UNSUBSCRIBE_SECRET, { userId: S.customerId, channel: "email" });
    const ctx = await newContext(browser); // no login: this page is public
    const page = await ctx.newPage();

    expect((await prefs(S.customerId))?.marketing_email).toBe(true);
    await page.goto(`/unsubscribe?token=${token}`);
    await expect(page.getByRole("heading", { name: "Unsubscribe from promotions" })).toBeVisible();
    await expect(page.getByText(/promotional emails/)).toBeVisible();
    // A link scanner opening the page must not unsubscribe anyone.
    expect((await prefs(S.customerId))?.marketing_email).toBe(true);

    await page.getByRole("button", { name: "Yes, unsubscribe me" }).click();
    await expect(page.getByText(/You will no longer get promotional emails/)).toBeVisible();
    expect((await prefs(S.customerId))?.marketing_email).toBe(false);
    const events = ok(await svc().from("message_consent_events").select("channel, granted, source").eq("user_id", S.customerId).order("created_at"), "consent events");
    expect(events.at(-1)).toMatchObject({ channel: "email", granted: false, source: "unsubscribe_link" });

    // The text-message short link only redirects to the confirm page.
    const smsToken = signUnsubscribeToken(UNSUBSCRIBE_SECRET, { userId: S.customerId, channel: "sms" });
    await page.goto(`/u/${smsToken}`);
    await expect(page).toHaveURL(new RegExp(`/unsubscribe\\?token=${smsToken.replace(/[.]/g, "\\.")}`));
    await expect(page.getByText(/promotional text messages/)).toBeVisible();

    // Forged, tampered and malformed links are refused with a plain message and change nothing.
    const forged = signUnsubscribeToken("some-other-secret", { userId: S.customerId, channel: "email" });
    for (const bad of [forged, `${token}x`, "garbage", ""]) {
      await page.goto(`/unsubscribe?token=${bad}`);
      await expect(page.getByText(/not valid, or it has expired/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Yes, unsubscribe me" })).toHaveCount(0);
    }
    await ctx.close();
  });

  test("RFC 8058 one-click: a plain POST to the list-unsubscribe URL works without a session", async ({ request }) => {
    ok(await svc().from("message_preferences").update({ marketing_email: true }).eq("user_id", S.customerId), "re-enable");
    const token = signUnsubscribeToken(UNSUBSCRIBE_SECRET, { userId: S.customerId, channel: "email" });

    const bad = await request.post(`/unsubscribe?token=${token}x`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
    expect(bad.status()).toBe(400);
    expect((await prefs(S.customerId))?.marketing_email).toBe(true);

    const good = await request.post(`/unsubscribe?token=${token}`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
    expect(good.status()).toBe(200);
    expect((await prefs(S.customerId))?.marketing_email).toBe(false);

    // Safe to repeat.
    expect((await request.post(`/unsubscribe?token=${token}`, { form: { "List-Unsubscribe": "One-Click" } })).status()).toBe(200);
    // GET on the same URL is just the confirm page.
    ok(await svc().from("message_preferences").update({ marketing_email: true }).eq("user_id", S.customerId), "re-enable");
    expect((await request.get(`/unsubscribe?token=${token}`)).status()).toBe(200);
    expect((await prefs(S.customerId))?.marketing_email).toBe(true);
  });
});
