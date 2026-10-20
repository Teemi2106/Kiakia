import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";
import { assertLocalStack, cycleUsers } from "../support/cycle-env";
import { assertStackSeeded, ok, registerRiderLikeTheApp, serviceClient } from "../support/supabase";

/**
 * Regression for the "admin form stuck pending forever" bug.
 *
 * A Server Action that revalidates used to leave its form disabled and
 * aria-busy with no success message, although the action had run, because
 * React dropped a Suspense ping while rendering the streamed action response
 * (root cause and fix: src/lib/client/buffer-action-responses.ts). This spec
 * drives the path that used to hang (soft navigation into a detail page, then
 * consecutive actions) with NO reload fallback: every step must settle on its
 * own.
 *
 * Self-contained: its own superadmin and riders, so it does not depend on (or
 * disturb) the full-cycle run it sits beside.
 */

const svc = () => serviceClient();
const runDigits = String(parseInt(cycleUsers.runId, 36) % 10_000_000).padStart(7, "0");
const phone = (slot: number) => `080${runDigits}${slot}`;
const adminUser = { email: `formadmin.${cycleUsers.runId}@e2e-cycle.test`, fullName: `Form Admin ${cycleUsers.runId}`, phone: phone(6) };
const riderUser = (n: number) => ({
  email: `formrider${n}.${cycleUsers.runId}@e2e-cycle.test`,
  fullName: `Form Rider ${n} ${cycleUsers.runId}`,
  phone: phone(7 + n),
});

async function expectIdle(page: Page): Promise<void> {
  await expect(page.locator("form[aria-busy='true'], button[aria-busy='true']")).toHaveCount(0, { timeout: 10_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("admin forms settle on their own (no reload)", () => {
  let riderIds: string[] = [];

  test.beforeAll(async () => {
    assertLocalStack();
    await assertStackSeeded();
    const created = await svc().auth.admin.createUser({
      email: adminUser.email,
      password: cycleUsers.password,
      email_confirm: true,
      user_metadata: { full_name: adminUser.fullName, phone: adminUser.phone },
    });
    if (created.error || !created.data.user) throw new Error(`createUser(form admin): ${created.error?.message}`);
    ok(await svc().from("user_roles").insert({ user_id: created.data.user.id, role: "superadmin" }), "grant superadmin");
    riderIds = [];
    for (const n of [1, 2]) riderIds.push((await registerRiderLikeTheApp(riderUser(n))).userId);
  });

  test("approving each document after a soft navigation, then the rider, never sticks", async ({ page }) => {
    await loginAsAdmin(page, adminUser.email, cycleUsers.password);
    // Keep the app idle-clean: any thrown render error or failed action is a failure here.
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    for (const [index, riderId] of riderIds.entries()) {
      await page.goto("/admin/riders");
      await page.waitForLoadState("networkidle");
      await page.getByRole("link", { name: riderUser(index + 1).fullName }).first().click();
      await expect(page).toHaveURL(new RegExp(`/admin/riders/${riderId}`));

      for (let remaining = 3; remaining > 0; remaining--) {
        const approve = page.getByRole("button", { name: "Approve document" });
        await expect(approve).toHaveCount(remaining);
        await approve.first().click();
        // No reload: the list must re-render by itself, and nothing may stay busy.
        await expect(approve).toHaveCount(remaining - 1, { timeout: 10_000 });
        await expectIdle(page);
      }

      await page.getByLabel("I have reviewed every document.").check();
      await page.getByRole("button", { name: "Approve rider" }).click();
      await expect(page.getByRole("button", { name: "Approve rider" })).toHaveCount(0, { timeout: 10_000 });
      await expectIdle(page);
      expect((await svc().from("riders").select("kyc_status").eq("user_id", riderId).single()).data?.kyc_status).toBe("approved");
    }
    expect(pageErrors).toEqual([]);
  });

  test("a navigation click while an action is in flight does not strand the form", async ({ page }) => {
    await loginAsAdmin(page, adminUser.email, cycleUsers.password);
    const rider = riderUser(1);
    await page.goto("/admin/riders");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: rider.fullName }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/riders/${riderIds[0]}`));
    await expect(page.getByRole("button", { name: "Reject rider" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Delay the action's POST so a navigation click is guaranteed to land while it is in flight.
    await page.route("**/admin/riders/**", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.getByLabel("I confirm this rider should be rejected.").check();
    await page.getByRole("button", { name: "Reject rider" }).click();
    await expect(page.getByRole("button", { name: "Reject rider" })).toBeDisabled();
    // Click a link while the POST is held. Next's router queues a navigation
    // behind an in-flight Server Action, so the URL changes once the action's
    // response lands; the form must settle either way.
    await page.getByRole("link", { name: "Riders", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/riders$/, { timeout: 15_000 });
    await page.unrouteAll({ behavior: "wait" });
    await expect.poll(async () => (await svc().from("riders").select("kyc_status").eq("user_id", riderIds[0]).single()).data?.kyc_status, { timeout: 15_000 }).toBe("rejected");
    await expectIdle(page);

    // The next action on the next page still works.
    await page.getByRole("link", { name: riderUser(2).fullName }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/riders/${riderIds[1]}`));
    await page.getByLabel("I confirm this rider should be rejected.").check();
    await page.getByRole("button", { name: "Reject rider" }).click();
    await expect(page.getByRole("button", { name: "Reject rider" })).toHaveCount(0, { timeout: 10_000 });
    await expectIdle(page);
  });
});
