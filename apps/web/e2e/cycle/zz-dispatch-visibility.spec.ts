import { expect, test, type Page } from "@playwright/test";
import { loginAs, loginAsAdmin, loginAsVendor } from "../fixtures";
import { IN_AREA, assertLocalStack, cycleUsers } from "../support/cycle-env";
import { liveOffer, offersFor, retireStaleDispatchOrders } from "../support/dispatch";
import { sendMonnifyWebhook, setMockTransaction } from "../support/monnify-webhook";
import { accountBalanceKobo, assertStackSeeded, createDraftOrderViaApi, initPendingPayment, ok, serviceClient, signIn, type Signed } from "../support/supabase";

/**
 * Rider matching visibility and the vendor "no rider near you" choice (0097/0098), under SEQUENTIAL dispatch
 * (one rider asked at a time, nearest first; 0100-0108). Cron dispatch-tick runs every 5 s on this stack, so no
 * assertion here depends on a tick having (or not having) happened at a given second.
 *
 * Named zz- on purpose: Playwright runs files alphabetically on the single
 * worker, and this spec reuses the store, customer, riders and superadmin that
 * full-cycle.spec.ts creates (it looks them up by their run-id emails). Run the
 * whole cycle (`pnpm --filter web e2e:cycle`), not this file alone on a fresh stack.
 *
 * Geometry: the store sits at IN_AREA (9.05, 7.45) and delivers 3 km (default).
 * One degree of latitude is about 111 km.
 */

const svc = () => serviceClient();
const FAR = { lat: 9.4, lng: 7.45 }; // ~39 km: in range when there is no cap, but far too costly for the order to pay
const MID = { lat: 9.068, lng: 7.45 }; // ~2 km: outside a 1 km first round, inside the store's 3 km

let vendorId = "";
let adminId = "";
let customerSess: Signed;
let vendorSess: Signed;
let rider1: Signed;
let rider2: Signed;

async function setRider(rider: Signed, online: boolean, at?: { lat: number; lng: number }): Promise<void> {
  ok(await rider.db.rpc("set_rider_online", { p_is_online: online }), "set_rider_online");
  if (online && at) ok(await rider.db.rpc("update_rider_location", { p_lat: at.lat, p_lng: at.lng }), "update_rider_location");
}

/** Customer places and pays; the vendor accepts, prepares and marks it ready (as the app's actions do); the wait clock is backdated past the 60 s the status view requires. */
async function readyOrder(): Promise<{ id: string; code: string; total_kobo: number; delivery_fee_kobo: number }> {
  const item = ok(await svc().from("menu_items").select("id").eq("vendor_id", vendorId).eq("name", cycleUsers.dish.name).single(), "item");
  const order = await createDraftOrderViaApi(customerSess, { vendorId, menuItemId: item.id, qty: 1, at: IN_AREA });
  const ref = await initPendingPayment(order, (input) => setMockTransaction(input));
  await setMockTransaction({ paymentReference: order.code, paymentStatus: "PAID", amountPaidNaira: order.total_kobo / 100, paymentMethod: "CARD" });
  expect((await sendMonnifyWebhook(ref)).status).toBe(200);
  await expect.poll(async () => (await svc().from("orders").select("status").eq("id", order.id).single()).data?.status, { timeout: 15_000 }).toBe("placed");
  for (const to of ["accepted", "preparing", "ready_for_pickup"]) {
    ok(await vendorSess.db.rpc("transition_order", { p_order_id: order.id, p_to_status: to, p_actor_type: "vendor", p_actor_id: vendorSess.userId }), `vendor -> ${to}`);
  }
  ok(await svc().from("orders").update({ ready_at: new Date(Date.now() - 5 * 60_000).toISOString() }).eq("id", order.id), "backdate ready_at");
  const row = ok(await svc().from("orders").select("id, code, total_kobo, delivery_fee_kobo").eq("id", order.id).single(), "order");
  return row as { id: string; code: string; total_kobo: number; delivery_fee_kobo: number };
}

async function gotoHydrated(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

async function setDispatchSetting(key: string, value: number): Promise<void> {
  ok(await svc().rpc("admin_set_dispatch_setting", { p_key: key, p_value: value, p_reason: "e2e setup", p_actor_id: adminId }), `set ${key}`);
}

test.describe.configure({ mode: "serial" });

test.describe("rider matching visibility and vendor self-delivery", () => {
  test.beforeAll(async () => {
    assertLocalStack();
    await assertStackSeeded();
    // full-cycle.spec.ts already created the superadmin; look it up (bootstrapSuperadmin() would fail on the duplicate).
    const users = ok(await svc().auth.admin.listUsers({ perPage: 1000 }), "list users") as { users: Array<{ id: string; email?: string }> };
    const admin = users.users.find((user) => user.email === cycleUsers.admin.email);
    if (!admin) throw new Error("The superadmin from full-cycle.spec.ts does not exist: run the whole cycle first.");
    adminId = admin.id;
    const vendor = await svc().from("vendors").select("id").eq("name", cycleUsers.storeName).maybeSingle();
    if (!vendor.data) throw new Error("The store from full-cycle.spec.ts does not exist: run the whole cycle (this spec follows it), not this file alone.");
    vendorId = vendor.data.id;
    customerSess = await signIn(cycleUsers.customer.email);
    vendorSess = await signIn(cycleUsers.vendor.email);
    rider1 = await signIn(cycleUsers.rider.email);
    rider2 = await signIn(cycleUsers.rider2.email);
    // Orders a failed earlier run left waiting would be offered to this run's riders by the tick (see support/dispatch.ts).
    await retireStaleDispatchOrders();
    await setDispatchSetting("dispatch_radius_m", 0);
    await setDispatchSetting("dispatch_widen_after_seconds", 60);
  });

  test.afterAll(async () => {
    await setDispatchSetting("dispatch_radius_m", 0);
    await setDispatchSetting("dispatch_widen_after_seconds", 60);
    await Promise.all([setRider(rider1, false), setRider(rider2, false)]).catch(() => undefined);
  });

  test("an order whose only rider is too costly to pay shows the plain reason on /admin/dispatch and the Overview tile", async ({ page }) => {
    await setRider(rider1, true, FAR);
    await setRider(rider2, false);
    const order = await readyOrder();

    await loginAsAdmin(page, cycleUsers.admin.email, cycleUsers.password);
    await gotoHydrated(page, "/admin/dispatch");
    await expect(page.getByRole("heading", { name: "Waiting for a rider" })).toBeVisible();
    const row = page.locator("li", { hasText: `Order ${order.code}` });
    await expect(row).toContainText("paying them for this distance would cost more than this order brings in");
    await expect(row.getByRole("link", { name: `Open order ${order.code}` })).toBeVisible();
    // Nobody is asked: the only rider is too costly, so there is no live offer and no offer row at all.
    expect(await offersFor(order.id)).toEqual([]);
    await expect(row).toContainText("Nobody right now"); // "Being asked now"

    await gotoHydrated(page, "/admin");
    await expect(page.getByRole("link", { name: /Orders waiting for a rider/ })).toBeVisible();

    // The same reason sits on the order page, with the redispatch button.
    await gotoHydrated(page, `/admin/orders/${order.id}`);
    await expect(page.getByText("This order is waiting for a rider")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send to riders again" })).toBeVisible();
  });

  test("the admin sets a first-round distance; the vendor then sees the banner and Look further away creates an offer", async ({ page, browser }) => {
    await loginAsAdmin(page, cycleUsers.admin.email, cycleUsers.password);
    await gotoHydrated(page, "/admin/settings");
    const card = page.getByRole("heading", { name: "First search distance" }).locator("xpath=..");
    await card.getByLabel(/New distance/).fill("1");
    await card.getByLabel("Why are you changing it?").fill("e2e: try nearby riders first");
    await card.getByLabel(/I understand this applies to orders from now on/).check();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText(/Saved\. It applies to orders from now on/)).toBeVisible();
    expect((await svc().from("platform_settings").select("value_int").eq("key", "dispatch_radius_m").single()).data?.value_int).toBe(1000);
    await gotoHydrated(page, "/admin/settings");
    await expect(page.getByText("Recent rider matching changes")).toBeVisible();
    await expect(page.getByText(/e2e: try nearby riders first/).first()).toBeVisible();

    // The order's wait clock is backdated 5 minutes, so switch automatic widening off here: otherwise it has already widened by itself (which is the feature, covered by the unit tests) and the vendor has nothing left to ask for.
    await setDispatchSetting("dispatch_widen_after_seconds", 0);
    await setRider(rider1, true, MID);
    const order = await readyOrder();

    const vendorPage = await (await browser.newContext()).newPage();
    await loginAsVendor(vendorPage, cycleUsers.vendor.email, cycleUsers.password);
    await gotoHydrated(vendorPage, `/dashboard/orders/${order.id}`);
    await expect(vendorPage.getByText("No rider is near you right now.")).toBeVisible();
    await vendorPage.getByRole("button", { name: "Look further away (up to 3 km)" }).click();
    // Regression: the banner used to vanish once the state moved on to "offers pending", taking the result line with it.
    await expect(vendorPage.getByText("Sent to 1 rider.")).toBeVisible({ timeout: 15_000 });
    // Sequential dispatch: ONE offer, to the only rider in range; the banner now says how the search works.
    const offers = await offersFor(order.id);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ rider_id: rider1.userId, status: "offered", attempt_no: 1 });
    await expect(vendorPage.getByText("Finding a rider: asking riders one at a time, nearest first.")).toBeVisible();
    await expect(vendorPage.getByRole("alert").filter({ hasText: "No rider is near you right now." })).toHaveCount(0); // the choice is gone, the result line stays
    await expect(vendorPage.getByText("Sent to 1 rider.")).toBeVisible();
    await vendorPage.reload();
    await vendorPage.waitForLoadState("networkidle");
    await expect(vendorPage.getByText("Finding a rider: asking riders one at a time, nearest first.")).toBeVisible();

    // The asked rider declines and nobody else can be asked (a decliner is never re-asked; rider 2 is offline):
    // the vendor is offered the choice again, and "Look further away" is rate-limited with a ticking countdown.
    ok(await rider1.db.rpc("decline_dispatch_offer", { p_order_id: order.id }), "decline");
    expect(await liveOffer(order.id)).toBeNull();
    const expandAgain = vendorPage.getByRole("button", { name: /^Look further away \(try again in \d+:\d\d\)$/ });
    await vendorPage.reload();
    await vendorPage.waitForLoadState("networkidle");
    await expect(vendorPage.getByText("No rider is near you right now.")).toBeVisible({ timeout: 15_000 });
    await expect(expandAgain).toBeDisabled();
    const secondsOf = async () => {
      const [, m, sec] = /try again in (\d+):(\d\d)/.exec((await expandAgain.textContent()) ?? "") ?? [];
      return Number(m) * 60 + Number(sec);
    };
    const first = await secondsOf();
    await expect.poll(secondsOf, { timeout: 10_000, message: "the countdown should tick down on its own" }).toBeLessThan(first);
    await vendorPage.context().close();
  });

  test("I'll deliver it myself: steps, wrong code refused, right code delivers; the customer sees Delivered by the store; the vendor is owed the delivery fee", async ({ page, browser }) => {
    await setRider(rider1, false);
    await setRider(rider2, false);
    const order = await readyOrder();
    const owedBefore = await accountBalanceKobo("vendor", vendorId);

    const vendorPage = await (await browser.newContext()).newPage();
    await loginAsVendor(vendorPage, cycleUsers.vendor.email, cycleUsers.password);
    await gotoHydrated(vendorPage, `/dashboard/orders/${order.id}`);
    await expect(vendorPage.getByText("No rider is near you right now.")).toBeVisible();
    await vendorPage.getByRole("button", { name: "I'll deliver it myself" }).click();
    await expect(vendorPage.getByText(/This cannot be undone once you start/)).toBeVisible();
    await vendorPage.getByRole("button", { name: "Yes, I'll deliver it" }).click();
    await expect(vendorPage.getByRole("heading", { name: "You are delivering this order" })).toBeVisible({ timeout: 15_000 });
    expect((await svc().from("orders").select("delivery_by").eq("id", order.id).single()).data?.delivery_by).toBe("vendor");

    for (const label of ["I've picked it up", "I'm on my way", "I've arrived"]) {
      await vendorPage.getByRole("button", { name: label }).click();
    }
    await expect(vendorPage.getByLabel("Enter the customer's code to complete")).toBeVisible({ timeout: 15_000 });
    // The steps are optimistic on screen; the database catches up a moment later.
    await expect.poll(async () => (await svc().from("orders").select("status").eq("id", order.id).single()).data?.status, { timeout: 15_000 }).toBe("arrived");

    // The customer sees the store, not a rider.
    await loginAs(page, cycleUsers.customer.email, cycleUsers.password);
    await gotoHydrated(page, `/orders/${order.id}/tracking`);
    await expect(page.getByText(`Delivered by ${cycleUsers.storeName}`).first()).toBeVisible();
    await expect(page.getByText("Waiting for a rider to be assigned")).toHaveCount(0);

    const code = ok(await svc().from("order_delivery_codes").select("code").eq("order_id", order.id).single(), "code").code as string;
    const wrong = code === "0000" ? "1111" : "0000";
    await vendorPage.getByLabel("Enter the customer's code to complete").fill(wrong);
    await vendorPage.getByRole("button", { name: "Complete delivery" }).click();
    await expect(vendorPage.getByText(/That code is not right/)).toBeVisible({ timeout: 15_000 });
    expect((await svc().from("orders").select("status").eq("id", order.id).single()).data?.status).toBe("arrived");

    await vendorPage.getByLabel("Enter the customer's code to complete").fill(code);
    await vendorPage.getByRole("button", { name: "Complete delivery" }).click();
    await expect(vendorPage.getByText("Delivered.")).toBeVisible({ timeout: 15_000 });
    expect((await svc().from("orders").select("status").eq("id", order.id).single()).data?.status).toBe("delivered");

    // The vendor's balance grew by their share of the food plus the whole delivery fee.
    const owedAfter = await accountBalanceKobo("vendor", vendorId);
    expect(owedAfter - owedBefore).toBeGreaterThan(order.delivery_fee_kobo);

    // Admin: the store is listed under payouts, and the order says the store delivered it.
    await page.context().clearCookies(); // this page is still signed in as the customer
    await loginAsAdmin(page, cycleUsers.admin.email, cycleUsers.password);
    await gotoHydrated(page, "/admin/payouts");
    await expect(page.getByText(cycleUsers.storeName).first()).toBeVisible();
    await gotoHydrated(page, `/admin/orders/${order.id}`);
    await expect(page.getByText("The store delivers this order itself")).toBeVisible();
    await expect(page.getByRole("button", { name: "Offer to riders" })).toHaveCount(0);
    await vendorPage.context().close();
  });
});
