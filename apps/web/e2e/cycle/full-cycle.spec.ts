import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { loginAsAdmin, loginAsVendor } from "../fixtures";
import { IN_AREA, assertLocalStack, cycleEnv, cycleUsers } from "../support/cycle-env";
import {
  accountBalanceKobo,
  assertStackSeeded,
  bootstrapSuperadmin,
  createDraftOrderViaApi,
  initPendingPayment,
  latestOrderForCustomer,
  ledgerFor,
  netFor,
  ok,
  registerRiderLikeTheApp,
  serviceClient,
  signIn,
  unbalancedTransactions,
  type Signed,
} from "../support/supabase";
import { formatNaira, koboOf } from "@kiakia/domain";
import { getMockRefunds, sendMonnifyWebhook, setMockTransaction } from "../support/monnify-webhook";

/**
 * ONE order, signup to payout, against a throwaway local Supabase stack
 * (see e2e/README.md). The steps are ordered and depend on each other, so the
 * whole describe is serial: the first failure stops the run instead of
 * cascading into misleading failures further down.
 *
 * What is real: the Next.js app, Supabase Auth/PostgREST/Storage/Postgres
 * (all migrations + seed), and the monnify-webhook Edge Function. What is
 * stood in: Monnify's REST API (e2e/support/monnify-mock.mjs) and the
 * separate-repo rider app (its RPCs are called with supabase-js as a signed-in
 * rider, exactly as that app does).
 */

const S: {
  adminId: string;
  customerId: string;
  vendorId: string;
  vendorSlug: string;
  rider: Signed;
  orderId: string;
  orderCode: string;
  transactionReference: string;
  rider2: Signed;
  riderFeeKobo: number;
  deliveryCode: string;
  wrongCode: string;
  vendorShareKobo: number;
  riderShareKobo: number;
  walletBefore: number;
  refundOrder1: { id: string; code: string; total_kobo: number };
} = {} as never;

let customerSess: Signed;
const customerApi = () => customerSess;

let customerCtx: BrowserContext;
let vendorCtx: BrowserContext;
let adminCtx: BrowserContext;
let customer: Page;
let vendor: Page;
let admin: Page;

const svc = () => serviceClient();
/** The one order the cycle follows (the side orders of 4e/9x are created later and are not "latest" for long). */
const mainOrder = async () => ok(await svc().from("orders").select("*").eq("id", S.orderId).single(), "main order");

/** A side order, driven over the API up to "paid and placed": cart -> place_order -> pending payment -> signed webhook. */
async function paidSideOrder(customerApiSession: Signed): Promise<{ id: string; code: string; total_kobo: number }> {
  const item = ok(await svc().from("menu_items").select("id").eq("vendor_id", S.vendorId).eq("name", cycleUsers.dish.name).single(), "item");
  const order = await createDraftOrderViaApi(customerApiSession, { vendorId: S.vendorId, menuItemId: item.id, qty: 1, at: IN_AREA });
  const ref = await initPendingPayment(order, (input) => setMockTransaction(input));
  await setMockTransaction({ paymentReference: order.code, paymentStatus: "PAID", amountPaidNaira: order.total_kobo / 100, paymentMethod: "CARD" });
  expect((await sendMonnifyWebhook(ref)).status).toBe(200);
  await expect.poll(async () => (await svc().from("orders").select("status").eq("id", order.id).single()).data?.status, { timeout: 15_000 }).toBe("placed");
  return order;
}

/**
 * `page.goto` resolves before React has hydrated; a click that lands in that
 * gap is silently dropped by the production build. Waiting for the network to
 * go idle (websockets do not count) is the cheapest honest "hydrated" signal.
 */
async function gotoHydrated(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

test.describe.configure({ mode: "serial" });

test.describe("full cycle: signup -> order -> payment -> delivery -> payout", () => {
  test.beforeAll(async ({ browser }) => {
    assertLocalStack();
    await assertStackSeeded();
    const geo = { geolocation: IN_AREA, permissions: ["geolocation"] };
    customerCtx = await browser.newContext(geo);
    vendorCtx = await browser.newContext(geo);
    adminCtx = await browser.newContext();
    customer = await customerCtx.newPage();
    vendor = await vendorCtx.newPage();
    admin = await adminCtx.newPage();
    // Belt and braces: the browser must never reach a hosted Supabase.
    for (const ctx of [customerCtx, vendorCtx, adminCtx]) {
      await ctx.route(/https?:\/\/[^/]*\.supabase\.(co|in)\//, (route) => route.abort());
    }
  });

  test.afterAll(async () => {
    await Promise.all([customerCtx?.close(), vendorCtx?.close(), adminCtx?.close()]);
  });

  // ------------------------------------------------------------------ 0
  test("0. preflight: the app under test is wired to the local stack, not a hosted project", async () => {
    // The superadmin exists ONLY in the local stack's database, so a
    // successful sign-in through the app proves the app's server talks to it.
    S.adminId = await bootstrapSuperadmin();
    await loginAsAdmin(admin, cycleUsers.admin.email, cycleUsers.password);

    // And the client bundle's inlined Supabase URL is the local one.
    const html = await (await admin.request.get("/login")).text();
    const chunkPaths = [...html.matchAll(/\/_next\/static\/[^"'\s]+\.js/g)].map((m) => m[0]);
    const bodies = await Promise.all(chunkPaths.map(async (p) => (await admin.request.get(p)).text()));
    expect(bodies.some((b) => b.includes(new URL(cycleEnv.supabaseUrl).host))).toBe(true);
  });

  // ------------------------------------------------------------------ 1
  test("1a. a new customer signs up through the real /register form", async () => {
    await customer.goto("/register");
    await customer.getByLabel("Full name").fill(cycleUsers.customer.fullName);
    await customer.getByLabel("Email address").fill(cycleUsers.customer.email);
    await customer.getByLabel("Phone number").fill(cycleUsers.customer.phone);
    await customer.getByLabel("Password", { exact: true }).fill(cycleUsers.password);
    await customer.getByLabel("Confirm password", { exact: true }).fill(cycleUsers.password);
    await customer.getByRole("button", { name: "Create account" }).click();
    // The local stack has email confirmations off (supabase/config.toml
    // [auth.email] enable_confirmations = false), so signUp returns a session
    // and the action redirects straight to /home. With confirmations on you
    // would read the mail from the stack's Inbucket/Mailpit instead.
    await expect(customer).toHaveURL(/\/home/, { timeout: 30_000 });

    const profiles = ok(await svc().from("profiles").select("id, full_name, phone").eq("full_name", cycleUsers.customer.fullName), "profiles");
    expect(profiles).toHaveLength(1);
    S.customerId = profiles[0].id;
    customerSess = await signIn(cycleUsers.customer.email);
    const roles = ok(await svc().from("user_roles").select("role").eq("user_id", S.customerId), "roles");
    expect(roles.map((r: { role: string }) => r.role)).toContain("customer");
  });

  test("1b. a new vendor signs up, applies for a store, and lists a dish through the real UI", async () => {
    await vendor.goto("/vendor/register");
    await vendor.getByLabel("Full name").fill(cycleUsers.vendor.fullName);
    await vendor.getByLabel("Email address").fill(cycleUsers.vendor.email);
    await vendor.getByLabel("Phone number").fill(cycleUsers.vendor.phone);
    await vendor.getByLabel("Password", { exact: true }).fill(cycleUsers.password);
    await vendor.getByLabel("Confirm password", { exact: true }).fill(cycleUsers.password);
    await vendor.getByRole("button", { name: "Create account" }).click();
    await expect(vendor).toHaveURL(/\/onboarding/, { timeout: 30_000 });

    await vendor.getByLabel("Store Name").fill(cycleUsers.storeName);
    await vendor.getByLabel("Store Address").fill("1 Cycle Close, Abuja");
    await vendor.getByLabel("State").fill("FCT");
    await vendor.getByRole("button", { name: /Use my current location/ }).click();
    await expect(vendor.getByRole("button", { name: /Location captured/ })).toBeVisible();
    await vendor.getByRole("button", { name: /Create my store/ }).click();
    await expect(vendor).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    const vendors = ok(await svc().from("vendors").select("id, slug, status, commission_bps, service_area_id").eq("name", cycleUsers.storeName), "vendors");
    expect(vendors).toHaveLength(1);
    S.vendorId = vendors[0].id;
    S.vendorSlug = vendors[0].slug;
    // A new store is NOT live: it waits for an admin (step 2).
    expect(vendors[0].status).toBe("pending");

    await gotoHydrated(vendor, "/dashboard/menu/items/new");
    await vendor.getByLabel("Item Name").fill(cycleUsers.dish.name);
    await vendor.getByLabel("Description").fill("Party jollof for the cycle test");
    await vendor.getByLabel("Price (₦)").fill(String(cycleUsers.dish.priceNaira));
    await vendor.getByRole("button", { name: "Add item" }).click();
    await expect(vendor).toHaveURL(/\/dashboard\/menu$/, { timeout: 30_000 });
    await expect
      .poll(async () => (await svc().from("menu_items").select("price_kobo").eq("vendor_id", S.vendorId).eq("name", cycleUsers.dish.name)).data?.[0]?.price_kobo)
      .toBe(cycleUsers.dish.priceNaira * 100);
  });

  test("1c. a new rider registers and uploads KYC documents (the rider app's RPCs, via supabase-js)", async () => {
    S.rider = await registerRiderLikeTheApp(cycleUsers.rider);
    const rider = ok(await svc().from("riders").select("kyc_status, is_online").eq("user_id", S.rider.userId).single(), "rider");
    expect(rider).toMatchObject({ kyc_status: "pending", is_online: false });
    const docs = ok(await svc().from("rider_documents").select("doc_type, status").eq("rider_id", S.rider.userId), "docs");
    expect(docs).toHaveLength(3);
    expect(docs.every((d: { status: string }) => d.status === "pending")).toBe(true);

    // A pending rider cannot take themselves online.
    const online = await S.rider.db.rpc("set_rider_online", { p_is_online: true });
    expect(online.error?.message ?? "").toMatch(/not kyc-approved/);
  });

  // ------------------------------------------------------------------ 2
  test("2a. admin approves the vendor from the real admin UI", async () => {
    // Hydrated before every click: a click that lands before React has attached
    // its handlers is silently dropped by the production build, which made this
    // step intermittent (the button looked clicked, nothing was submitted).
    await gotoHydrated(admin, `/admin/vendors?status=pending&q=${encodeURIComponent(cycleUsers.storeName)}`);
    await admin.getByRole("link", { name: "Review", exact: true }).click();
    await expect(admin).toHaveURL(new RegExp(`/admin/vendors/${S.vendorId}`));
    await admin.waitForLoadState("networkidle");
    await expect(admin.getByText("Pending approval").first()).toBeVisible();
    await admin.getByRole("button", { name: "Approve vendor" }).click();
    await expect
      .poll(async () => (await svc().from("vendors").select("status").eq("id", S.vendorId).single()).data?.status)
      .toBe("active");
    // The page settles by itself: the pending banner and the button go away, no reload.
    await expect(admin.getByRole("button", { name: "Approve vendor" })).toHaveCount(0);
    const audit = ok(await svc().from("admin_audit_log").select("action").eq("actor_id", S.adminId), "audit");
    expect(JSON.stringify(audit)).toMatch(/vendor/i);
  });

  test("2b. the approved vendor signs back in through /vendor/login and opens the kitchen (real UI)", async () => {
    await vendorCtx.clearCookies(); // drop the signup session: prove a fresh vendor sign-in works
    await loginAsVendor(vendor, cycleUsers.vendor.email, cycleUsers.password);
    await gotoHydrated(vendor, "/dashboard/settings");
    // The switch is a styled label around a visually hidden checkbox: click the label text.
    await vendor.getByText("Accepting orders", { exact: true }).click();
    await expect(vendor.getByRole("checkbox", { name: /Accepting orders/ })).toBeChecked();
    await vendor.getByRole("button", { name: "Save Changes" }).click();
    await expect(vendor.getByText("Saved.")).toBeVisible();
    await expect
      .poll(async () => (await svc().from("vendors").select("is_accepting_orders").eq("id", S.vendorId).single()).data?.is_accepting_orders)
      .toBe(true);
  });

  test("2c. admin approves the rider's three documents and then the rider", async () => {
    await gotoHydrated(admin, `/admin/riders`);
    await admin.getByRole("link", { name: cycleUsers.rider.fullName }).first().click();
    await expect(admin).toHaveURL(new RegExp(`/admin/riders/${S.rider.userId}`));
    await expect(admin.getByRole("button", { name: "Approve document" })).toHaveCount(3);

    for (let remaining = 3; remaining > 0; remaining--) {
      const approve = admin.getByRole("button", { name: "Approve document" });
      await expect(approve).toHaveCount(remaining);
      await approve.first().click();
      // Ground truth first: the action itself must have been applied.
      await expect
        .poll(async () => (await svc().from("rider_documents").select("id").eq("rider_id", S.rider.userId).eq("status", "approved")).data?.length, { timeout: 20_000 })
        .toBe(3 - remaining + 1);
      // No reload fallback: the list re-renders by itself (regression: e2e/cycle/admin-forms.spec.ts).
      await expect(approve).toHaveCount(remaining - 1);
    }
    const docs = ok(await svc().from("rider_documents").select("status").eq("rider_id", S.rider.userId), "docs");
    expect(docs.map((d: { status: string }) => d.status)).toEqual(["approved", "approved", "approved"]);

    await admin.getByLabel("I have reviewed every document.").check();
    await admin.getByRole("button", { name: "Approve rider" }).click();
    await expect
      .poll(async () => (await svc().from("riders").select("kyc_status").eq("user_id", S.rider.userId).single()).data?.kyc_status)
      .toBe("approved");
    await expect(admin.getByRole("button", { name: "Approve rider" })).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 3
  test("3a. cart: add is instant, survives navigation and reload, and there is only ever one cart", async () => {
    const customerAt = { latitude: 9.06, longitude: 7.46 }; // ~1.5 km from the vendor, still inside the service area
    await customerCtx.setGeolocation(customerAt);
    const dish = cycleUsers.dish.name;
    const cartButton = customer.getByRole("button", { name: /^Cart/ });
    const openCarts = async () =>
      ok(await svc().from("carts").select("id, vendor_id, status").eq("customer_id", S.customerId).eq("status", "open"), "carts") as Array<{ id: string; vendor_id: string }>;
    const cartLines = async () =>
      ok(await svc().from("cart_items").select("qty, menu_item_id").in("cart_id", (await openCarts()).map((c) => c.id)), "cart_items") as Array<{ qty: number }>;

    // Hold every cart write back for 3s. Anything the UI shows before that is
    // optimistic state, not a database round trip.
    await customer.route(/\/rest\/v1\/(carts|cart_items)/, async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 3_000));
      await route.continue();
    });

    await gotoHydrated(customer, `/vendors/${S.vendorSlug}`);
    await customer.getByRole("button", { name: `Add ${dish}` }).click();
    // Instant: the badge updates well inside the 3s the write is being held,
    // and the database really has nothing yet at that moment.
    await expect(cartButton).toHaveAccessibleName("Cart, 1 item", { timeout: 1_500 });
    expect(await openCarts()).toHaveLength(0);
    await expect.poll(async () => (await cartLines()).length, { timeout: 15_000 }).toBe(1);
    await customer.unroute(/\/rest\/v1\/(carts|cart_items)/);

    // Survives client-side navigation (the store lives in the layout, not the page)...
    await customer.getByRole("link", { name: "Orders", exact: true }).first().click();
    await expect(customer).toHaveURL(/\/orders/);
    await expect(cartButton).toHaveAccessibleName("Cart, 1 item");
    // ...and a hard reload (it is persisted, then re-hydrated from the server).
    await customer.reload();
    await expect(cartButton).toHaveAccessibleName("Cart, 1 item");

    // One cart: another kitchen's item triggers the "clear and start over" confirm.
    await gotoHydrated(customer, "/vendors/the-place");
    customer.once("dialog", (d) => void d.dismiss());
    await customer.getByRole("button", { name: "Add Jollof Rice" }).click();
    await expect(cartButton).toHaveAccessibleName("Cart, 1 item");
    expect(await openCarts()).toEqual([expect.objectContaining({ vendor_id: S.vendorId })]);

    customer.once("dialog", (d) => {
      expect(d.message()).toMatch(/another restaurant/i);
      void d.accept();
    });
    await customer.getByRole("button", { name: "Add Jollof Rice" }).click();
    await expect.poll(async () => (await openCarts()).map((c) => c.vendor_id), { timeout: 15_000 }).toEqual([expect.not.stringMatching(S.vendorId)]);
    const abandoned = ok(await svc().from("carts").select("id").eq("customer_id", S.customerId).eq("status", "abandoned"), "abandoned");
    expect(abandoned).toHaveLength(1);

    // Back to the real kitchen: swap again, then bump the quantity to 2.
    await gotoHydrated(customer, `/vendors/${S.vendorSlug}`);
    customer.once("dialog", (d) => void d.accept());
    await customer.getByRole("button", { name: `Add ${dish}` }).click();
    await expect.poll(async () => (await openCarts()).map((c) => c.vendor_id), { timeout: 15_000 }).toEqual([S.vendorId]);
    await customer.getByRole("button", { name: `Add one more ${dish}` }).click();
    await expect(cartButton).toHaveAccessibleName("Cart, 2 items");
    await expect.poll(async () => (await cartLines()).map((l) => l.qty), { timeout: 15_000 }).toEqual([2]);
  });

  test("3b. checkout creates a pending-payment order and hands off to Monnify", async () => {
    await gotoHydrated(customer, "/cart");
    await expect(customer.getByText(cycleUsers.dish.name).first()).toBeVisible();
    await customer.getByRole("link", { name: /Proceed to Checkout/ }).click();
    await expect(customer).toHaveURL(/\/checkout/);
    await customer.waitForLoadState("networkidle");

    await customer.getByRole("button", { name: "Add new address" }).click();
    await customer.getByPlaceholder("Enter your street address").fill("5 Cycle Avenue");
    await customer.getByRole("button", { name: /Use my current location/ }).click();
    await expect(customer.getByRole("button", { name: /Location captured/ })).toBeVisible();
    await customer.getByRole("button", { name: "Save Address" }).click();
    await expect(customer.getByText("5 Cycle Avenue").first()).toBeVisible();

    await customer.getByRole("button", { name: /Pay with Card/ }).click();
    // placeOrderAction -> place_order() -> Monnify init-transaction (the mock) -> redirect to its checkoutUrl.
    await expect(customer).toHaveURL(new RegExp(`${new URL(cycleEnv.monnifyMockUrl).port}/checkout/`), { timeout: 30_000 });
    await expect(customer.getByRole("heading", { name: /Mock Monnify hosted checkout/ })).toBeVisible();

    const order = await latestOrderForCustomer(S.customerId);
    expect(order).toBeTruthy();
    S.orderId = order!.id;
    S.orderCode = order!.code;
    // Pending payment: nothing is paid, nobody is notified, no money has moved.
    expect(order).toMatchObject({ status: "draft", payment_status: "pending" });
    expect(order!.subtotal_kobo).toBe(cycleUsers.dish.priceNaira * 100 * 2);
    expect(order!.total_kobo).toBe(order!.subtotal_kobo + order!.delivery_fee_kobo + order!.service_fee_kobo - order!.discount_kobo);
    expect(await ledgerFor(S.orderId)).toHaveLength(0);

    const payment = ok(await svc().from("payments").select("status, amount_kobo, provider_ref").eq("idempotency_key", S.orderCode).single(), "payment");
    expect(payment).toMatchObject({ status: "pending", amount_kobo: order!.total_kobo });
    S.transactionReference = payment.provider_ref;
  });

  // ------------------------------------------------------------------ 4
  test("4a. webhook trust boundary: a bad or missing signature is rejected before anything is touched", async () => {
    const forged = await sendMonnifyWebhook(S.transactionReference, { signature: "00".repeat(64) });
    expect(forged.status).toBe(401);
    const unsigned = await sendMonnifyWebhook(S.transactionReference, { signature: null });
    expect(unsigned.status).toBe(401);
    const wrongSecret = await sendMonnifyWebhook(S.transactionReference, { secret: "not-the-secret" });
    expect(wrongSecret.status).toBe(401);
    expect(await ledgerFor(S.orderId)).toHaveLength(0);
    expect((await mainOrder())!.status).toBe("draft");
  });

  test("4b. a correctly signed webhook that CLAIMS payment is ignored while Monnify itself says PENDING", async () => {
    // The payload says amountPaid 1 / PAID (see sendMonnifyWebhook); the
    // function must only believe what it re-fetches from Monnify.
    const res = await sendMonnifyWebhook(S.transactionReference);
    expect(res.status).toBe(200);
    const order = await mainOrder();
    expect(order).toMatchObject({ status: "draft", payment_status: "pending" });
    expect(await ledgerFor(S.orderId)).toHaveLength(0);
  });

  test("4c. the customer pays: a signed webhook marks the order paid, holds escrow and books a balanced ledger", async () => {
    const order = await mainOrder();
    await setMockTransaction({ paymentReference: S.orderCode, paymentStatus: "PAID", amountPaidNaira: order!.total_kobo / 100, paymentMethod: "CARD" });
    const res = await sendMonnifyWebhook(S.transactionReference);
    expect(res).toMatchObject({ status: 200 });

    await expect.poll(async () => (await mainOrder())?.payment_status, { timeout: 15_000 }).toBe("paid");
    const paid = (await mainOrder())!;
    expect(paid.status).toBe("placed");

    const ledger = await ledgerFor(S.orderId);
    expect(netFor(ledger, { ownerType: "platform", kind: "escrow" })).toBe(paid.total_kobo); // escrow HOLDS the full total
    expect(netFor(ledger, { ownerType: "platform", kind: "gateway" })).toBe(-paid.total_kobo);
    expect(ledger.map((l) => l.entry_type)).toEqual(["payment_capture", "payment_capture"]);
    expect(unbalancedTransactions(ledger)).toEqual([]);
    const payment = ok(await svc().from("payments").select("status, channel").eq("idempotency_key", S.orderCode).single(), "payment");
    expect(payment).toMatchObject({ status: "success", channel: "card" });

    // The vendor is told (the customer too).
    const vendorNotes = ok(await svc().from("notifications").select("title").eq("vendor_id", S.vendorId).eq("order_id", S.orderId), "vendor notifications");
    expect(vendorNotes.map((n: { title: string }) => n.title)).toContain("New order");
    const customerNotes = ok(await svc().from("notifications").select("title").eq("customer_id", S.customerId).eq("order_id", S.orderId), "customer notifications");
    expect(customerNotes.map((n: { title: string }) => n.title)).toContain("Order placed!");
  });

  test("4d. a replayed webhook is idempotent: no second ledger transaction, no second credit", async () => {
    const before = await ledgerFor(S.orderId);
    const replay = await sendMonnifyWebhook(S.transactionReference);
    expect(replay.status).toBe(200);
    const again = await sendMonnifyWebhook(S.transactionReference);
    expect(again.status).toBe(200);
    const after = await ledgerFor(S.orderId);
    expect(after).toHaveLength(before.length);
    expect(netFor(after, { ownerType: "platform", kind: "escrow" })).toBe((await mainOrder())!.total_kobo);
    const txns = ok(await svc().from("transactions").select("id").eq("order_id", S.orderId).eq("kind", "payment_capture"), "transactions");
    expect(txns).toHaveLength(1);
    expect((await mainOrder())!.status).toBe("placed");
  });

  test("4e. a wrong-amount payment is flagged under admin 'Problems to review' (underpaid: not placed, credited to the wallet)", async () => {
    const item = ok(await svc().from("menu_items").select("id").eq("vendor_id", S.vendorId).eq("name", cycleUsers.dish.name).single(), "item");
    const side = await createDraftOrderViaApi(customerApi(), { vendorId: S.vendorId, menuItemId: item.id, qty: 1, at: IN_AREA });
    const ref = await initPendingPayment(side, (input) => setMockTransaction(input));
    const paidKobo = side.total_kobo - 10_000; // ₦100 short
    await setMockTransaction({ paymentReference: side.code, paymentStatus: "PAID", amountPaidNaira: paidKobo / 100, paymentMethod: "ACCOUNT_TRANSFER" });
    expect((await sendMonnifyWebhook(ref)).status).toBe(200);

    const after = ok(await svc().from("orders").select("status, payment_status").eq("id", side.id).single(), "side order");
    expect(after.status).toBe("draft"); // an underpaid order must NOT go to the kitchen
    expect(after.payment_status).not.toBe("paid");
    const ledger = await ledgerFor(side.id);
    expect(netFor(ledger, { ownerType: "platform", kind: "escrow" })).toBe(0);
    expect(unbalancedTransactions(ledger)).toEqual([]);
    expect(netFor(ledger, { ownerType: "customer", kind: "wallet" })).toBe(paidKobo); // wallet credited with what was received

    await admin.goto("/admin/flagged-orders");
    await expect(admin.getByRole("heading", { name: "Problems to review" })).toBeVisible();
    await expect(admin.getByText(/paid only/i).first()).toBeVisible();
    await expect(admin.getByText(side.code).first()).toBeVisible();
  });

  // ------------------------------------------------------------------ 5/6
  test("5a. vendor (real UI) accepts the order and starts preparing; the customer is notified at each step", async () => {
    await gotoHydrated(vendor, "/dashboard/orders");
    await expect(vendor.getByText(S.orderCode).first()).toBeVisible({ timeout: 20_000 });
    await vendor.getByRole("button", { name: "Accept Order" }).click();
    await expect.poll(async () => (await mainOrder())?.status, { timeout: 15_000 }).toBe("accepted");
    await vendor.getByRole("button", { name: "Start Preparing" }).click();
    await expect.poll(async () => (await mainOrder())?.status, { timeout: 15_000 }).toBe("preparing");

    const titles = ok(await svc().from("notifications").select("title").eq("customer_id", S.customerId).eq("order_id", S.orderId), "notes").map((n: { title: string }) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["Order placed!", "Order accepted", "Order in the kitchen"]));
  });

  test("5b. a second rider is approved and both riders go online with a location (rider RPCs)", async () => {
    S.rider2 = await registerRiderLikeTheApp(cycleUsers.rider2);
    // Rider 2's approval is not the thing under test (rider 1 already went through the admin UI),
    // so it is done with the same service-role RPC the admin action calls.
    ok(await svc().rpc("approve_rider", { p_rider_id: S.rider2.userId, p_actor_id: S.adminId, p_reason: "e2e second rider" }), "approve_rider");

    for (const [rider, at] of [
      [S.rider, { lat: 9.051, lng: 7.451 }],
      [S.rider2, { lat: 9.052, lng: 7.452 }],
    ] as const) {
      const online = ok(await rider.db.rpc("set_rider_online", { p_is_online: true }), "set_rider_online") as { is_online: boolean };
      expect(online.is_online).toBe(true);
      ok(await rider.db.rpc("update_rider_location", { p_lat: at.lat, p_lng: at.lng }), "update_rider_location");
    }
    const riders = ok(await svc().from("riders").select("user_id, is_online, last_ping_at").in("user_id", [S.rider.userId, S.rider2.userId]), "riders");
    expect(riders.every((r: { is_online: boolean; last_ping_at: string | null }) => r.is_online && r.last_ping_at)).toBe(true);
  });

  test("5c. vendor (real UI) marks the order ready; the customer is notified and dispatch offers go out", async () => {
    // The stack outlives a run, so riders left online by an earlier run (or by admin-forms.spec) would be
    // offered this order too. Take every rider except this run's two offline so the offer set is exact.
    ok(await svc().from("riders").update({ is_online: false }).not("user_id", "in", `(${S.rider.userId},${S.rider2.userId})`), "park other riders");
    await vendor.reload();
    await vendor.waitForLoadState("networkidle");
    await vendor.getByRole("button", { name: "Mark Ready for Pickup" }).click();
    await expect.poll(async () => (await mainOrder())?.status, { timeout: 15_000 }).toBe("ready_for_pickup");

    const customerTitles = ok(await svc().from("notifications").select("title").eq("customer_id", S.customerId).eq("order_id", S.orderId), "notes").map((n: { title: string }) => n.title);
    expect(customerTitles).toContain("Order ready");

    // The kitchen's own transitions never notify the vendor about itself; only the "New order" row exists so far.
    const vendorTitles = ok(await svc().from("notifications").select("title").eq("vendor_id", S.vendorId).eq("order_id", S.orderId), "vendor notes").map((n: { title: string }) => n.title);
    expect(vendorTitles).toEqual(["New order"]);

    // Dispatch (trigger on ready_for_pickup): both online, approved riders were offered the order.
    const offers = ok(await svc().from("dispatch_offers").select("rider_id, status").eq("order_id", S.orderId), "offers") as Array<{ rider_id: string; status: string }>;
    expect(offers.map((o) => o.rider_id).sort()).toEqual([S.rider.userId, S.rider2.userId].sort());
    expect(offers.every((o) => o.status === "offered")).toBe(true);

    // Each rider sees only their own offer (RLS), and can read what it is for.
    const mine = ok(await S.rider.db.from("dispatch_offers").select("rider_id").eq("order_id", S.orderId), "rider's offers") as Array<{ rider_id: string }>;
    expect(mine).toEqual([{ rider_id: S.rider.userId }]);
    const details = ok(await S.rider.db.rpc("get_rider_offer_details", { p_order_id: S.orderId }), "offer details") as Array<{ order_code: string; total_kobo: number }>;
    expect(details[0].order_code).toBe(S.orderCode);
  });

  test("6a. an unaccepted offer expires and is re-dispatched; an explicit decline is final", async () => {
    // Rider 2 explicitly declines.
    ok(await S.rider2.db.rpc("decline_dispatch_offer", { p_order_id: S.orderId }), "decline");
    // Rider 1 never answers: push the offer past its 60s TTL and run the sweep exactly as the scheduler would.
    ok(await svc().from("dispatch_offers").update({ expires_at: new Date(Date.now() - 5_000).toISOString() }).eq("order_id", S.orderId).eq("rider_id", S.rider.userId), "backdate offer");
    const swept = ok(await svc().rpc("sweep_dispatch_offers"), "sweep") as Array<{ offers_expired: number; offers_created: number; orders_cancelled: number }>;
    expect(swept[0].offers_expired).toBeGreaterThanOrEqual(1);
    expect(swept[0].orders_cancelled).toBe(0);

    const offers = ok(await svc().from("dispatch_offers").select("rider_id, status, expires_at").eq("order_id", S.orderId), "offers") as Array<{ rider_id: string; status: string; expires_at: string }>;
    const r1 = offers.find((o) => o.rider_id === S.rider.userId)!;
    const r2 = offers.find((o) => o.rider_id === S.rider2.userId)!;
    expect(r2.status).toBe("declined"); // never re-offered
    expect(r1.status).toBe("offered"); // re-dispatched with a fresh window
    expect(new Date(r1.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect((await mainOrder())!.status).toBe("ready_for_pickup"); // still waiting, not cancelled

    // A declined rider cannot accept afterwards.
    const lateAccept = await S.rider2.db.rpc("accept_dispatch_offer", { p_order_id: S.orderId });
    expect(lateAccept.error).not.toBeNull();
  });

  test("6b. rider 1 accepts; the order is assigned, the vendor and customer are told, and the tracking page shows the rider", async () => {
    const accepted = ok(await S.rider.db.rpc("accept_dispatch_offer", { p_order_id: S.orderId }), "accept") as { status: string; rider_id: string; rider_fee_kobo: number };
    expect(accepted).toMatchObject({ status: "rider_assigned", rider_id: S.rider.userId });
    expect(accepted.rider_fee_kobo).toBeGreaterThan(0);
    S.riderFeeKobo = accepted.rider_fee_kobo;

    const order = (await mainOrder())!;
    expect(order).toMatchObject({ status: "rider_assigned", rider_id: S.rider.userId });
    const vendorTitles = ok(await svc().from("notifications").select("title").eq("vendor_id", S.vendorId).eq("order_id", S.orderId), "vendor notes").map((n: { title: string }) => n.title);
    expect(vendorTitles).toContain("Rider on the way");
    const customerTitles = ok(await svc().from("notifications").select("title").eq("customer_id", S.customerId).eq("order_id", S.orderId), "notes").map((n: { title: string }) => n.title);
    expect(customerTitles).toContain("Rider assigned");

    // A location ping now fans out to the order's live-map row.
    ok(await S.rider.db.rpc("update_rider_location", { p_lat: 9.0505, p_lng: 7.4505 }), "ping");
    const tracking = ok(await customerApi().db.rpc("get_order_tracking", { p_order_id: S.orderId }), "tracking") as Array<{ rider_lat: number; rider_lng: number; rider_name: string; status: string }>;
    expect(tracking[0]).toMatchObject({ status: "rider_assigned", rider_lat: 9.0505, rider_lng: 7.4505, rider_name: cycleUsers.rider.fullName });

    await gotoHydrated(customer, `/orders/${S.orderId}/tracking`);
    await expect(customer.getByRole("heading", { name: "Rider assigned" })).toBeVisible();
    await expect(customer.getByText(cycleUsers.rider.fullName).first()).toBeVisible();
  });

  test("6c. picked up -> out for delivery -> arrived; the tracking page follows each step", async () => {
    const headline = (text: string) => customer.getByRole("heading", { name: text, level: 1 });

    ok(await S.rider.db.rpc("transition_order", { p_order_id: S.orderId, p_to_status: "picked_up", p_actor_type: "rider", p_actor_id: S.rider.userId }), "picked_up");
    // Realtime first (the page subscribes to order changes); a reload is the fallback, recorded if it was needed.
    await expect(headline("Order picked up")).toBeVisible({ timeout: 20_000 }).catch(async () => {
      test.info().annotations.push({ type: "realtime-fallback", description: "tracking page did not update live after picked_up; needed a reload" });
      await customer.reload();
      await expect(headline("Order picked up")).toBeVisible();
    });

    ok(await S.rider.db.rpc("transition_order", { p_order_id: S.orderId, p_to_status: "in_transit", p_actor_type: "rider", p_actor_id: S.rider.userId }), "in_transit");
    await customer.reload();
    await expect(headline("Rider is on the way")).toBeVisible();

    ok(await S.rider.db.rpc("transition_order", { p_order_id: S.orderId, p_to_status: "arrived", p_actor_type: "rider", p_actor_id: S.rider.userId }), "arrived");
    await customer.reload();
    await expect(headline("Rider has arrived")).toBeVisible();
    const titles = ok(await svc().from("notifications").select("title").eq("customer_id", S.customerId).eq("order_id", S.orderId), "notes").map((n: { title: string }) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["Order picked up", "On the way", "Rider has arrived"]));
  });

  // ------------------------------------------------------------------ 7
  test("7a. the delivery code reaches only the customer; a wrong code is rejected and repeated failures lock the rider out", async () => {
    // Customer path: RLS lets the order's own customer read it. The rider cannot.
    const mine = ok(await customerApi().db.from("order_delivery_codes").select("code").eq("order_id", S.orderId), "customer code") as Array<{ code: string }>;
    expect(mine).toHaveLength(1);
    S.deliveryCode = mine[0].code;
    const riderRead = ok(await S.rider.db.from("order_delivery_codes").select("code").eq("order_id", S.orderId), "rider code read") as unknown[];
    expect(riderRead).toEqual([]);
    const vendorRead = ok(await (await signIn(cycleUsers.vendor.email)).db.from("order_delivery_codes").select("code").eq("order_id", S.orderId), "vendor code read") as unknown[];
    expect(vendorRead).toEqual([]);

    // The same code shows in the UI behind the reveal toggle.
    await customer.reload();
    await customer.getByRole("button", { name: "Reveal code" }).first().click();
    for (const digit of new Set(S.deliveryCode.split(""))) {
      await expect(customer.locator("span.font-extrabold", { hasText: new RegExp(`^${digit}$`) }).first()).toBeVisible();
    }

    const wrong = S.deliveryCode.replace(/\d/g, (d) => String((Number(d) + 1) % 10));
    S.wrongCode = wrong;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = ok(await S.rider.db.rpc("verify_delivery_and_release_escrow", { p_order_id: S.orderId, p_delivery_code: wrong }), `wrong code #${attempt}`) as { code_matched: boolean };
      expect(result.code_matched).toBe(false);
    }
    // Locked out: even the CORRECT code is refused now.
    const locked = await S.rider.db.rpc("verify_delivery_and_release_escrow", { p_order_id: S.orderId, p_delivery_code: S.deliveryCode });
    expect(locked.error?.message ?? "").toMatch(/too many incorrect/i);
    expect((await mainOrder())!.status).toBe("arrived");
    const releases = ok(await svc().from("transactions").select("id").eq("order_id", S.orderId).eq("kind", "escrow_release"), "releases");
    expect(releases).toEqual([]);
  });

  test("7b. admin resets the lockout in the real UI; the right code then releases escrow with the agreed split", async () => {
    await gotoHydrated(admin, `/admin/orders/${S.orderId}`);
    await admin.getByLabel("I have confirmed this with the customer.").check();
    await admin.getByRole("button", { name: "Reset delivery code attempts" }).click();
    await expect
      .poll(async () => {
        const r = await S.rider.db.rpc("verify_delivery_and_release_escrow", { p_order_id: S.orderId, p_delivery_code: S.wrongCode });
        // Not locked any more: a wrong code is a normal (non-error) "no match" again.
        return r.error ? r.error.message : (r.data as { code_matched: boolean }).code_matched;
      }, { timeout: 20_000 })
      .toBe(false);

    const result = ok(await S.rider.db.rpc("verify_delivery_and_release_escrow", { p_order_id: S.orderId, p_delivery_code: S.deliveryCode }), "verify") as { code_matched: boolean; order_row: { status: string } };
    expect(result.code_matched).toBe(true);
    expect(result.order_row.status).toBe("delivered");

    const order = (await mainOrder())!;
    expect(order.status).toBe("delivered");
    const vendorRow = ok(await svc().from("vendors").select("commission_bps").eq("id", S.vendorId).single(), "vendor") as { commission_bps: number };
    const commission = Math.round((order.subtotal_kobo * vendorRow.commission_bps) / 10_000);
    S.vendorShareKobo = order.subtotal_kobo - commission;
    S.riderShareKobo = order.rider_fee_kobo;
    const platformShare = order.total_kobo - S.vendorShareKobo - S.riderShareKobo;

    const ledger = await ledgerFor(S.orderId);
    expect(unbalancedTransactions(ledger)).toEqual([]);
    const release = ["escrow_release"];
    expect(netFor(ledger, { ownerType: "vendor", kind: "available", ownerId: S.vendorId }, release)).toBe(S.vendorShareKobo); // subtotal minus the vendor's commission cut
    expect(netFor(ledger, { ownerType: "rider", kind: "available", ownerId: S.rider.userId }, release)).toBe(S.riderShareKobo); // orders.rider_fee_kobo
    expect(netFor(ledger, { ownerType: "platform", kind: "revenue" }, release)).toBe(platformShare); // the residual
    expect(netFor(ledger, { ownerType: "platform", kind: "escrow" })).toBe(0); // everything held was released
    const net = ledger.reduce((sum, r) => sum + (r.direction === "credit" ? r.amount_kobo : -r.amount_kobo), 0);
    expect(net).toBe(0); // the whole order's ledger sums to zero
    expect(S.vendorShareKobo + S.riderShareKobo + platformShare).toBe(order.total_kobo);
    // What the rider is paid is the distance-based rider fee frozen at accept time. It is NOT the customer-facing
    // delivery fee in general; record the difference so a change in policy is visible in the run output.
    test.info().annotations.push({ type: "split", description: `vendor=${S.vendorShareKobo} rider=${S.riderShareKobo} (delivery_fee=${order.delivery_fee_kobo}) platform=${platformShare} total=${order.total_kobo}` });
    expect(S.riderShareKobo).toBe(S.riderFeeKobo);

    // Idempotent: a retried verify does not release twice.
    const again = ok(await S.rider.db.rpc("verify_delivery_and_release_escrow", { p_order_id: S.orderId, p_delivery_code: S.deliveryCode }), "retry") as { code_matched: boolean };
    expect(again.code_matched).toBe(true);
    expect(ok(await svc().from("transactions").select("id").eq("order_id", S.orderId).eq("kind", "escrow_release"), "releases")).toHaveLength(1);

    // Both sides are told, and the rider's earnings reflect the delivery.
    const customerTitles = ok(await svc().from("notifications").select("title").eq("customer_id", S.customerId).eq("order_id", S.orderId), "notes").map((n: { title: string }) => n.title);
    expect(customerTitles).toContain("Order delivered");
    const vendorTitles = ok(await svc().from("notifications").select("title").eq("vendor_id", S.vendorId).eq("order_id", S.orderId), "vendor notes").map((n: { title: string }) => n.title);
    expect(vendorTitles).toEqual(expect.arrayContaining(["New order", "Rider on the way", "Order picked up", "Order delivered"]));
    const earnings = ok(await S.rider.db.rpc("get_rider_earnings"), "earnings") as Array<{ account_kind: string; balance_kobo: number }>;
    expect(earnings.find((e) => e.account_kind === "available")?.balance_kobo).toBe(S.riderShareKobo);

    await customer.goto(`/orders/${S.orderId}/tracking`);
    await expect(customer.getByRole("heading", { name: "Order delivered", level: 1 })).toBeVisible();
  });

  // ------------------------------------------------------------------ 8
  test("8a. /admin/payouts 'To pay' lists the vendor and the rider with the right naira amounts", async () => {
    await gotoHydrated(admin, "/admin/payouts");
    const vendorCard = admin.getByRole("listitem").filter({ hasText: cycleUsers.storeName });
    const riderCard = admin.getByRole("listitem").filter({ hasText: cycleUsers.rider.fullName });
    await expect(vendorCard).toContainText("Vendor");
    await expect(vendorCard).toContainText(formatNaira(koboOf(S.vendorShareKobo)));
    await expect(riderCard).toContainText("Rider");
    await expect(riderCard).toContainText(formatNaira(koboOf(S.riderShareKobo)));
    expect(await accountBalanceKobo("vendor", S.vendorId)).toBe(S.vendorShareKobo);
    expect(await accountBalanceKobo("rider", S.rider.userId)).toBe(S.riderShareKobo);
  });

  test("8b. admin marks the vendor paid in two parts; a reused bank reference is rejected; a re-submit does not pay twice", async () => {
    const ref1 = `E2E-V1-${cycleUsers.runId}`;
    const ref2 = `E2E-V2-${cycleUsers.runId}`;
    const part = 100_000; // ₦1,000.00
    const card = () => admin.getByRole("listitem").filter({ hasText: cycleUsers.storeName });
    const submit = async (amountNaira: string, reference: string) => {
      await gotoHydrated(admin, "/admin/payouts");
      const c = card();
      await c.getByLabel("Amount you paid (naira)").fill(amountNaira);
      await c.getByLabel("Bank transfer reference").fill(reference);
      await c.getByLabel(/I have already sent this money/).check();
      await c.getByRole("button", { name: "Mark as paid" }).click();
    };

    await submit("1000", ref1);
    await expect.poll(() => accountBalanceKobo("vendor", S.vendorId), { timeout: 20_000 }).toBe(S.vendorShareKobo - part);
    await expect(card().getByRole("status")).toBeVisible();

    // Same reference, different amount: rejected (the error path does not revalidate, so the message shows), nothing booked.
    await submit("500", ref1);
    await expect(card().getByRole("alert")).toContainText("already been used", { timeout: 20_000 });
    expect(await accountBalanceKobo("vendor", S.vendorId)).toBe(S.vendorShareKobo - part);

    // Same reference, same amount (a double click / retry): idempotent, no second debit.
    await submit("1000", ref1);
    await expect.poll(async () => (await svc().from("transactions").select("id").eq("kind", "payout").eq("reference", `payout-${ref1}`)).data?.length).toBe(1);
    await expect(card().getByRole("status")).toBeVisible();
    expect(await accountBalanceKobo("vendor", S.vendorId)).toBe(S.vendorShareKobo - part);

    // Pay the rest (the form pre-fills what is still owed).
    await gotoHydrated(admin, "/admin/payouts");
    const c = card();
    await expect(c).toContainText(formatNaira(koboOf(S.vendorShareKobo - part)));
    await c.getByLabel("Bank transfer reference").fill(ref2);
    await c.getByLabel(/I have already sent this money/).check();
    await c.getByRole("button", { name: "Mark as paid" }).click();
    await expect.poll(() => accountBalanceKobo("vendor", S.vendorId), { timeout: 20_000 }).toBe(0);
  });

  test("8c. admin pays the rider in full; balances are zero, history lists every payout, and each is in the audit log", async () => {
    await gotoHydrated(admin, "/admin/payouts");
    const riderCard = admin.getByRole("listitem").filter({ hasText: cycleUsers.rider.fullName });
    await riderCard.getByLabel("Bank transfer reference").fill(`E2E-R1-${cycleUsers.runId}`);
    await riderCard.getByLabel(/I have already sent this money/).check();
    await riderCard.getByRole("button", { name: "Mark as paid" }).click();
    await expect.poll(() => accountBalanceKobo("rider", S.rider.userId), { timeout: 20_000 }).toBe(0);
    expect(await accountBalanceKobo("vendor", S.vendorId)).toBe(0);

    // To pay no longer lists either of them.
    await gotoHydrated(admin, "/admin/payouts");
    await expect(admin.getByRole("listitem").filter({ hasText: cycleUsers.storeName })).toHaveCount(0);
    await expect(admin.getByRole("listitem").filter({ hasText: cycleUsers.rider.fullName })).toHaveCount(0);

    // History shows both, with their references and amounts.
    await gotoHydrated(admin, "/admin/payouts?tab=history");
    const rows = admin.getByRole("row");
    await expect(rows.filter({ hasText: cycleUsers.storeName }).filter({ hasText: `E2E-V1-${cycleUsers.runId}` })).toContainText("₦1,000.00");
    await expect(rows.filter({ hasText: cycleUsers.storeName }).filter({ hasText: `E2E-V2-${cycleUsers.runId}` })).toContainText(formatNaira(koboOf(S.vendorShareKobo - 100_000)));
    await expect(rows.filter({ hasText: cycleUsers.rider.fullName }).filter({ hasText: `E2E-R1-${cycleUsers.runId}` })).toContainText(formatNaira(koboOf(S.riderShareKobo)));

    // One audit entry per recorded payout (the idempotent re-submit and the rejected reuse wrote none).
    const audit = ok(await svc().from("admin_audit_log").select("action, actor_id").eq("actor_id", S.adminId).like("action", "%payout%"), "audit") as Array<{ action: string }>;
    expect(audit).toHaveLength(3);
    await gotoHydrated(admin, "/admin/audit");
    await expect(admin.getByText(/payout/i).first()).toBeVisible();
  });

  // ------------------------------------------------------------------ 9
  test("9a. a vendor rejection refunds the customer's money into their wallet, unwinding escrow", async () => {
    const customerSess = customerApi();
    S.walletBefore = ok(await customerSess.db.rpc("get_wallet_balance"), "wallet") as number;
    const refundOrder = await paidSideOrder(customerSess);
    S.refundOrder1 = refundOrder;

    await gotoHydrated(vendor, "/dashboard/orders");
    await expect(vendor.getByText(refundOrder.code).first()).toBeVisible({ timeout: 20_000 });
    await vendor.getByRole("button", { name: "Reject" }).click();
    await expect.poll(async () => (await svc().from("orders").select("status").eq("id", refundOrder.id).single()).data?.status, { timeout: 15_000 }).toBe("rejected_by_vendor");

    const ledger = await ledgerFor(refundOrder.id);
    expect(unbalancedTransactions(ledger)).toEqual([]);
    expect(netFor(ledger, { ownerType: "platform", kind: "escrow" })).toBe(0);
    expect(netFor(ledger, { ownerType: "customer", kind: "wallet" })).toBe(refundOrder.total_kobo);
    const wallet = ok(await customerSess.db.rpc("get_wallet_balance"), "wallet") as number;
    expect(wallet - S.walletBefore).toBe(refundOrder.total_kobo);
    const titles = ok(await svc().from("notifications").select("title").eq("customer_id", S.customerId).eq("order_id", refundOrder.id), "notes").map((n: { title: string }) => n.title);
    expect(titles).toContain("Order declined");

    await customer.goto("/profile/wallet");
    await expect(customer.getByText(formatNaira(koboOf(wallet))).first()).toBeVisible();
  });

  test("9b. an admin gateway refund unwinds escrow and sends the refund request to Monnify", async () => {
    const refundOrder = await paidSideOrder(customerApi());
    await gotoHydrated(admin, `/admin/orders/${refundOrder.id}`);
    await admin.getByLabel("Send the refund to").selectOption("gateway");
    await admin.getByLabel("Reason").fill("e2e: customer asked for the money back on their card");
    await admin.getByLabel("I confirm the customer should be refunded in full.").check();
    await admin.getByRole("button", { name: "Refund customer" }).click();

    await expect.poll(async () => netFor(await ledgerFor(refundOrder.id), { ownerType: "platform", kind: "escrow" }), { timeout: 20_000 }).toBe(0);
    const ledger = await ledgerFor(refundOrder.id);
    expect(unbalancedTransactions(ledger)).toEqual([]);
    expect(netFor(ledger, { ownerType: "customer", kind: "wallet" })).toBe(0); // gateway refund: nothing goes to the wallet
    await expect
      .poll(async () => (await getMockRefunds()).some((r) => r.refundReference === `${refundOrder.code}-refund` && r.refundAmount === refundOrder.total_kobo / 100), { timeout: 20_000 })
      .toBe(true);
  });
});
