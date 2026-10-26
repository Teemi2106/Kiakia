import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin, loginAsVendor } from "../fixtures";
import { IN_AREA, assertLocalStack, cycleUsers } from "../support/cycle-env";
import { advanceUntil, dispatchRow, lagosTime, liveOffer, offersFor, retireStaleDispatchOrders, setDispatchSettingAs } from "../support/dispatch";
import { sendMonnifyWebhook, setMockTransaction } from "../support/monnify-webhook";
import {
  assertStackSeeded,
  createDraftOrderViaApi,
  initPendingPayment,
  ledgerFor,
  netFor,
  ok,
  serviceClient,
  signIn,
  unbalancedTransactions,
  type Signed,
} from "../support/supabase";

/**
 * Sequential dispatch, end to end (docs/dispatch-design.md, D1-D8, D11): ONE rider is asked at a time, nearest
 * first; a decline asks the next rider immediately; an unanswered offer lapses after the offer time and the
 * search starts a new round; dispatch for an order still being prepared starts at a predicted time.
 *
 * Named yy- on purpose: Playwright runs files alphabetically on the single worker, and like
 * zz-dispatch-visibility.spec.ts this one reuses the store, customer, riders and superadmin that
 * full-cycle.spec.ts creates (looked up by their run-id emails). Run the whole cycle, not this file alone on
 * a fresh stack.
 *
 * Stood in: the rider app (its RPCs, via supabase-js as the signed-in rider). Not stood in: the scheduler.
 * pg_cron's dispatch-tick runs every 5 s on this stack and does the lapse/advance by itself; `advanceUntil`
 * only calls sweep_dispatch_offers() if the tick has not done it within 20 s of its due time, and the run says so.
 *
 * Geometry: the store is at IN_AREA (9.05, 7.45). Rider 1 is the nearer one (~160 m), rider 2 the farther (~470 m).
 */

const svc = () => serviceClient();
const NEAR = { lat: 9.051, lng: 7.451 };
const FARTHER = { lat: 9.053, lng: 7.453 };

let vendorId = "";
let adminId = "";
let customerSess: Signed;
let vendorSess: Signed;
let near: Signed; // cycleUsers.rider  (nearest)
let far: Signed; //  cycleUsers.rider2 (second nearest)

async function setRider(rider: Signed, online: boolean, at?: { lat: number; lng: number }): Promise<void> {
  ok(await rider.db.rpc("set_rider_online", { p_is_online: online }), "set_rider_online");
  if (online && at) ok(await rider.db.rpc("update_rider_location", { p_lat: at.lat, p_lng: at.lng }), "update_rider_location");
}

async function gotoHydrated(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

/** Customer places and pays (signed webhook); the order is `placed`, nothing else has happened yet. */
async function placedOrder(): Promise<{ id: string; code: string; total_kobo: number }> {
  const item = ok(await svc().from("menu_items").select("id").eq("vendor_id", vendorId).eq("name", cycleUsers.dish.name).single(), "item");
  const order = await createDraftOrderViaApi(customerSess, { vendorId, menuItemId: item.id, qty: 1, at: IN_AREA });
  const ref = await initPendingPayment(order, (input) => setMockTransaction(input));
  await setMockTransaction({ paymentReference: order.code, paymentStatus: "PAID", amountPaidNaira: order.total_kobo / 100, paymentMethod: "CARD" });
  expect((await sendMonnifyWebhook(ref)).status).toBe(200);
  await expect.poll(async () => (await svc().from("orders").select("status").eq("id", order.id).single()).data?.status, { timeout: 15_000 }).toBe("placed");
  return order;
}

async function vendorMoves(orderId: string, ...to: string[]): Promise<void> {
  for (const status of to) {
    ok(await vendorSess.db.rpc("transition_order", { p_order_id: orderId, p_to_status: status, p_actor_type: "vendor", p_actor_id: vendorSess.userId }), `vendor -> ${status}`);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("sequential dispatch: one rider at a time, nearest first", () => {
  test.beforeAll(async () => {
    assertLocalStack();
    await assertStackSeeded();
    const users = ok(await svc().auth.admin.listUsers({ perPage: 1000 }), "list users") as { users: Array<{ id: string; email?: string }> };
    const admin = users.users.find((user) => user.email === cycleUsers.admin.email);
    if (!admin) throw new Error("The superadmin from full-cycle.spec.ts does not exist: run the whole cycle first.");
    adminId = admin.id;
    const vendor = await svc().from("vendors").select("id").eq("name", cycleUsers.storeName).maybeSingle();
    if (!vendor.data) throw new Error("The store from full-cycle.spec.ts does not exist: run the whole cycle (this spec follows it), not this file alone.");
    vendorId = vendor.data.id;
    customerSess = await signIn(cycleUsers.customer.email);
    vendorSess = await signIn(cycleUsers.vendor.email);
    near = await signIn(cycleUsers.rider.email);
    far = await signIn(cycleUsers.rider2.email);
    await retireStaleDispatchOrders();
    // Known starting point whatever the stack's previous run left behind.
    await setDispatchSettingAs(adminId, "dispatch_offer_timeout_seconds", 45);
    await setDispatchSettingAs(adminId, "dispatch_radius_m", 0);
    await setDispatchSettingAs(adminId, "dispatch_widen_after_seconds", 60);
    await Promise.all([setRider(near, false), setRider(far, false)]);
  });

  test.afterAll(async () => {
    await setDispatchSettingAs(adminId, "dispatch_offer_timeout_seconds", 45).catch(() => undefined);
    await Promise.all([setRider(near, false), setRider(far, false)]).catch(() => undefined);
  });

  test("settings: the admin saves 'Offer time (seconds)' in the Rider matching section; an out-of-range value cannot be saved", async ({ page }) => {
    await loginAsAdmin(page, cycleUsers.admin.email, cycleUsers.password);
    await gotoHydrated(page, "/admin/settings");
    await expect(page.getByText(/^Riders are asked one at a time, nearest first\. Each rider has 45 seconds to answer\./)).toBeVisible();

    const card = page.getByRole("heading", { name: "Offer time", exact: true }).locator("xpath=..");
    await expect(card).toContainText("How long one rider has to accept or decline before the next rider is asked.");
    await expect(card).toContainText("45 seconds"); // Right now

    // 5 s is below the 15 s minimum: the form explains and will not save it.
    await card.getByLabel(/New offer time \(seconds/).fill("5");
    await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();
    expect((await svc().from("platform_settings").select("value_int").eq("key", "dispatch_offer_timeout_seconds").single()).data?.value_int).toBe(45);

    // 15 s (the minimum) keeps the lapses below short for the rest of this spec; afterAll restores 45.
    await card.getByLabel(/New offer time \(seconds/).fill("15");
    await card.getByLabel("Why are you changing it?").fill("e2e: shorten the offer time");
    await card.getByLabel(/I understand this applies to orders from now on/).check();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText(/Saved\. It applies to orders from now on/)).toBeVisible();
    expect((await svc().from("platform_settings").select("value_int").eq("key", "dispatch_offer_timeout_seconds").single()).data?.value_int).toBe(15);

    await gotoHydrated(page, "/admin/settings");
    await expect(page.getByText(/^Riders are asked one at a time, nearest first\. Each rider has 15 seconds to answer\./)).toBeVisible();
    await expect(page.getByText("Recent rider matching changes")).toBeVisible();
    await expect(page.getByText(/Offer time: .* to 15 seconds/).first()).toBeVisible();
    await expect(page.getByText(/e2e: shorten the offer time/).first()).toBeVisible();
  });

  test("preparing order: dispatch is scheduled for a predicted time; the vendor sees it, uses 'Need more time?' (+10 min) and the expected-ready line moves", async ({ page, browser }) => {
    await setRider(near, true, NEAR);
    await setRider(far, true, FARTHER);
    const order = await placedOrder();
    await vendorMoves(order.id, "accepted", "preparing");

    // Nobody is asked while the food is being made, even though two eligible riders are online.
    expect(await offersFor(order.id)).toEqual([]);
    const row = (await dispatchRow(order.id))!;
    expect(row.state).toBe("scheduled");
    const accepted = ok(await svc().from("orders").select("accepted_at").eq("id", order.id).single(), "accepted_at").accepted_at as string;
    // start_at = max(expected ready - travel - buffer, accepted_at), the basis is stored with the order (D8).
    const basis = row.start_basis as { travel_s: number; buffer_s: number; travel_source: string; buffer_source: string };
    expect(basis.travel_source).toBe("candidates"); // an eligible rider is online, so travel is that rider's ETA, not the default
    expect(basis.buffer_source).toBe("default");
    const expectedStart = Math.max(Date.parse(row.expected_ready_at!) - (basis.travel_s + basis.buffer_s) * 1000, Date.parse(accepted));
    expect(Math.abs(Date.parse(row.start_at!) - expectedStart)).toBeLessThan(5_000);
    expect(Date.parse(row.start_at!)).toBeGreaterThan(Date.now());

    // The vendor's order page: the ready time, the planned search start, no "Finding a rider" yet, and the control.
    const vendorCtx = await browser.newContext();
    const vendorPage = await vendorCtx.newPage();
    await loginAsVendor(vendorPage, cycleUsers.vendor.email, cycleUsers.password);
    await gotoHydrated(vendorPage, `/dashboard/orders/${order.id}`);
    await expect(vendorPage.getByText(`Food expected ready at ${lagosTime(row.expected_ready_at)}`)).toBeVisible();
    await expect(vendorPage.getByText(`Rider search starts around ${lagosTime(row.start_at)}`)).toBeVisible();
    await expect(vendorPage.getByText("Finding a rider: asking riders one at a time, nearest first.")).toHaveCount(0);
    await expect(vendorPage.getByRole("button", { name: "Look further away" })).toHaveCount(0); // not before the search has started

    // Admin: the order is listed under "Search starts later" with the same times.
    await loginAsAdmin(page, cycleUsers.admin.email, cycleUsers.password);
    await gotoHydrated(page, "/admin/dispatch");
    const upcoming = page.getByRole("listitem").filter({ hasText: order.code }).filter({ hasText: "search starts" });
    await expect(upcoming).toContainText(`Food expected ready ${lagosTime(row.expected_ready_at)}`);
    await expect(upcoming).toContainText(`search starts ${lagosTime(row.start_at)}`);

    // "Need more time?" +10 minutes.
    await vendorPage.getByRole("button", { name: "Need more time?" }).click();
    await vendorPage.getByRole("button", { name: "+10 min" }).click();
    await expect.poll(async () => Date.parse((await dispatchRow(order.id))!.expected_ready_at!) - Date.parse(row.expected_ready_at!), { timeout: 15_000 }).toBeGreaterThan(9 * 60_000);
    const later = (await dispatchRow(order.id))!;
    const addedMs = Date.parse(later.expected_ready_at!) - Date.parse(row.expected_ready_at!);
    expect(addedMs).toBeGreaterThan(9 * 60_000);
    expect(addedMs).toBeLessThan(12 * 60_000); // 10 minutes, plus the rounding up to a whole minute the control does
    expect(Date.parse(later.start_at!)).toBeGreaterThan(Date.parse(row.start_at!) + 5 * 60_000); // the search starts later too
    expect(await offersFor(order.id)).toEqual([]);
    // The page says so without a reload: the confirmation and the moved lines.
    await expect(vendorPage.getByText(`Got it. Food expected ready at ${lagosTime(later.expected_ready_at)}.`)).toBeVisible({ timeout: 15_000 });
    await expect(vendorPage.getByText(`Food expected ready at ${lagosTime(later.expected_ready_at)}`).first()).toBeVisible();
    await expect(vendorPage.getByText(`Rider search starts around ${lagosTime(later.start_at)}`)).toBeVisible();
    await expect(vendorPage.getByText(`Rider search starts around ${lagosTime(row.start_at)}`)).toHaveCount(0);

    // The store says "ready in 1 minute": the predicted start is now, so the search begins while the order is still `preparing`.
    await vendorPage.getByRole("button", { name: "Need more time?" }).click();
    await vendorPage.getByLabel("Or: ready in how many minutes from now?").fill("1");
    await vendorPage.getByRole("button", { name: "Update" }).click();
    await expect.poll(async () => Date.parse((await dispatchRow(order.id))!.expected_ready_at!) - Date.now(), { timeout: 15_000 }).toBeLessThan(2 * 60_000);
    const { usedFallback } = await advanceUntil(async () => (await liveOffer(order.id)) !== null, { timeoutMs: 90_000, cronGraceMs: 20_000 });
    if (usedFallback) test.info().annotations.push({ type: "cron-fallback", description: "dispatch-tick did not start the due search within 20 s; sweep_dispatch_offers() was called as the scheduler" });

    const offers = await offersFor(order.id);
    expect(offers).toHaveLength(1); // ONE rider asked, the nearest; the second rider is online and eligible but not asked
    expect(offers[0]).toMatchObject({ rider_id: near.userId, status: "offered", cycle_no: 1, attempt_no: 1 });
    expect((await svc().from("orders").select("status").eq("id", order.id).single()).data?.status).toBe("preparing");
    expect((await dispatchRow(order.id))!.state).toBe("offered");

    await vendorPage.reload();
    await vendorPage.waitForLoadState("networkidle");
    await expect(vendorPage.getByText("Finding a rider: asking riders one at a time, nearest first.")).toBeVisible();
    await expect(vendorPage.getByText(/^Rider search starts around/)).toHaveCount(0);
    await expect(vendorPage.getByRole("button", { name: "Need more time?" })).toBeVisible(); // still being prepared

    // The offered rider accepts early (the rider app's RPC); the order keeps `preparing` until the food is ready.
    const early = ok(await near.db.rpc("accept_dispatch_offer", { p_order_id: order.id }), "early accept") as { status: string; rider_id: string; rider_fee_kobo: number };
    expect(early.rider_id).toBe(near.userId);
    expect(early.status).toBe("preparing");
    expect((await offersFor(order.id)).map((o) => o.status)).toEqual(["accepted"]);
    expect(await liveOffer(order.id)).toBeNull();
    expect((await dispatchRow(order.id))!.state).toBe("assigned");

    // Food ready: the held rider is assigned at once; no new offer is made.
    await vendorMoves(order.id, "ready_for_pickup");
    await expect.poll(async () => (await svc().from("orders").select("status, rider_id").eq("id", order.id).single()).data, { timeout: 15_000 }).toMatchObject({ status: "rider_assigned", rider_id: near.userId });
    expect(await offersFor(order.id)).toHaveLength(1);

    // The delivery completes: picked up, on the way, arrived, the customer's code, escrow released.
    for (const to of ["picked_up", "in_transit", "arrived"]) {
      ok(await near.db.rpc("transition_order", { p_order_id: order.id, p_to_status: to, p_actor_type: "rider", p_actor_id: near.userId }), to);
    }
    const code = ok(await customerSess.db.from("order_delivery_codes").select("code").eq("order_id", order.id), "code")[0].code as string;
    const verified = ok(await near.db.rpc("verify_delivery_and_release_escrow", { p_order_id: order.id, p_delivery_code: code }), "verify") as { code_matched: boolean; order_row: { status: string; rider_fee_kobo: number } };
    expect(verified.code_matched).toBe(true);
    expect(verified.order_row.status).toBe("delivered");
    const ledger = await ledgerFor(order.id);
    expect(unbalancedTransactions(ledger)).toEqual([]);
    expect(netFor(ledger, { ownerType: "rider", kind: "available", ownerId: near.userId }, ["escrow_release"])).toBe(early.rider_fee_kobo);
    expect(netFor(ledger, { ownerType: "platform", kind: "escrow" })).toBe(0);
    await vendorCtx.close();
  });

  test("decline -> the next rider is asked at once and the admin sees it; the history lists every rider asked; a lapse starts a new round", async ({ page }) => {
    await setRider(near, true, NEAR);
    await setRider(far, true, FARTHER);
    const order = await placedOrder();
    await vendorMoves(order.id, "accepted", "preparing", "ready_for_pickup");
    // The status page lists orders that have waited over a minute: back-date the wait clock like the other specs do.
    ok(await svc().from("orders").update({ ready_at: new Date(Date.now() - 5 * 60_000).toISOString() }).eq("id", order.id), "backdate ready_at");

    // Ready: one live offer, to the nearest rider only.
    const first = await offersFor(order.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ rider_id: near.userId, status: "offered", attempt_no: 1 });
    expect(ok(await far.db.from("dispatch_offers").select("id").eq("order_id", order.id), "far's offers")).toEqual([]);

    await loginAsAdmin(page, cycleUsers.admin.email, cycleUsers.password);
    await gotoHydrated(page, "/admin/dispatch");
    const card = () => page.locator("li", { hasText: `Order ${order.code}` }).filter({ has: page.getByRole("link", { name: `Open order ${order.code}` }) });
    await expect(card()).toContainText(new RegExp(`Waiting for ${cycleUsers.rider.fullName} to answer, \\d+s left\\.`));
    await expect(card()).toContainText(`${cycleUsers.rider.fullName} (ask 1)`);
    const status1 = ok(await svc().rpc("admin_dispatch_status"), "admin_dispatch_status") as { stuck_orders: Array<{ order_id: string; reason: string; live_offer: { rider_name: string; attempt_no: number } | null }> };
    expect(status1.stuck_orders.find((o) => o.order_id === order.id)).toMatchObject({ reason: "waiting_for_rider_reply", live_offer: { rider_name: cycleUsers.rider.fullName, attempt_no: 1 } });

    // The nearest rider declines: the next one holds the live offer immediately (no tick, no sweep).
    ok(await near.db.rpc("decline_dispatch_offer", { p_order_id: order.id }), "decline");
    await expect.poll(async () => (await liveOffer(order.id))?.rider_id, { timeout: 5_000 }).toBe(far.userId);
    const second = await offersFor(order.id);
    expect(second.map((o) => [o.rider_id, o.status, o.attempt_no])).toEqual([
      [near.userId, "declined", 1],
      [far.userId, "offered", 2],
    ]);
    const status2 = ok(await svc().rpc("admin_dispatch_status"), "admin_dispatch_status") as typeof status1;
    expect(status2.stuck_orders.find((o) => o.order_id === order.id)).toMatchObject({ reason: "waiting_for_rider_reply", live_offer: { rider_name: cycleUsers.rider2.fullName, attempt_no: 2 } });
    await gotoHydrated(page, "/admin/dispatch");
    await expect(card()).toContainText(new RegExp(`Waiting for ${cycleUsers.rider2.fullName} to answer, \\d+s left\\.`));
    await expect(card()).toContainText(`${cycleUsers.rider2.fullName} (ask 2)`);

    // The per-order history: who was asked, in order, with the outcome.
    await card().getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/dispatch/${order.id}`));
    await expect(page.getByRole("heading", { name: new RegExp(`Dispatch history: order ${order.code}`) })).toBeVisible();
    const nearRow = page.getByRole("row").filter({ hasText: `Cycle Rider ${cycleUsers.runId}` });
    const farRow = page.getByRole("row").filter({ hasText: cycleUsers.rider2.fullName });
    await expect(nearRow).toContainText("Declined");
    await expect(farRow).toContainText(/Waiting for an answer|No answer in time/); // 15 s offers: tolerate a lapse during the page load
    await expect(page.getByText(`${cycleUsers.rider.fullName} declined.`)).toBeVisible();
    await expect(page.getByText(new RegExp(`${cycleUsers.rider2.fullName} was asked`))).toBeVisible();

    // The second rider never answers: the offer lapses (cron tick) and, with nobody untried left, a new round asks them again.
    const lapsesAt = Date.parse(second[1].expires_at);
    const { usedFallback } = await advanceUntil(async () => (await offersFor(order.id)).some((o) => o.attempt_no === 3 && o.status === "offered"), {
      timeoutMs: 90_000,
      cronGraceMs: Math.max(0, lapsesAt - Date.now()) + 20_000,
    });
    if (usedFallback) test.info().annotations.push({ type: "cron-fallback", description: "dispatch-tick did not advance the lapsed offer within 20 s of its expiry; sweep_dispatch_offers() was called as the scheduler" });
    const third = await offersFor(order.id);
    expect(third.map((o) => [o.rider_id, o.status, o.attempt_no, o.cycle_no])).toEqual([
      [near.userId, "declined", 1, 1],
      [far.userId, "expired", 2, 1],
      [far.userId, "offered", 3, 2],
    ]);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("row").filter({ hasText: cycleUsers.rider2.fullName })).toHaveCount(2);
    await expect(page.getByRole("row").filter({ hasText: "No answer in time" })).toContainText(cycleUsers.rider2.fullName);
    await expect(page.getByText(`${cycleUsers.rider2.fullName} did not answer in time.`)).toBeVisible();
    await expect(page.getByText("A new round of asking riders started.")).toHaveCount(2); // round 1 at the first ask, round 2 after the lapse

    // The asked rider accepts; the history ends in the acceptance and the status page no longer lists the order.
    const assigned = ok(await far.db.rpc("accept_dispatch_offer", { p_order_id: order.id }), "accept") as { status: string; rider_id: string };
    expect(assigned).toMatchObject({ status: "rider_assigned", rider_id: far.userId });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("row").filter({ hasText: cycleUsers.rider2.fullName }).filter({ hasText: "Accepted" })).toHaveCount(1);
    await gotoHydrated(page, "/admin/dispatch");
    await expect(page.locator("li", { hasText: `Order ${order.code}` })).toHaveCount(0);

    // Finish the delivery so the rider is free again (the stack outlives this run) and the second rider's path is covered too.
    for (const to of ["picked_up", "in_transit", "arrived"]) {
      ok(await far.db.rpc("transition_order", { p_order_id: order.id, p_to_status: to, p_actor_type: "rider", p_actor_id: far.userId }), to);
    }
    const code = ok(await customerSess.db.from("order_delivery_codes").select("code").eq("order_id", order.id), "code")[0].code as string;
    const verified = ok(await far.db.rpc("verify_delivery_and_release_escrow", { p_order_id: order.id, p_delivery_code: code }), "verify") as { code_matched: boolean; order_row: { status: string } };
    expect(verified).toMatchObject({ code_matched: true, order_row: { status: "delivered" } });
    expect(unbalancedTransactions(await ledgerFor(order.id))).toEqual([]);
  });
});
