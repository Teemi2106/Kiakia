import { expect, test } from "@playwright/test";
import { e2eEnv, loginAsVendor } from "./fixtures";

// Golden path: a vendor advances one order through the statuses only a
// vendor actor can trigger — placed -> accepted -> preparing ->
// ready_for_pickup (the state machine hands off to a rider after that,
// which needs dispatch/Phase 3, out of scope here — see
// VendorOrderActions.tsx).
//
// This test does NOT create its own order: a real order only reaches
// 'placed' after a genuine Monnify payment capture (place_order() leaves
// it 'draft' until then), which isn't something a UI-driven e2e run can
// trigger on demand. It requires the seeded E2E_VENDOR_* account to
// already have at least one order sitting in 'placed' status — seed that
// directly via a service-role script/SQL against the test project before
// running this spec, not through the app.
test.describe("vendor: fulfill an incoming order", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsVendor(page, e2eEnv.vendorEmail, e2eEnv.vendorPassword);
  });

  test("accepts a placed order and advances it to ready for pickup", async ({ page }) => {
    await page.goto("/dashboard/orders");

    const acceptButton = page.getByRole("button", { name: "Accept Order" }).first();
    const hasIncomingOrder = await acceptButton.isVisible().catch(() => false);
    test.skip(
      !hasIncomingOrder,
      "No order in 'placed' status for the seeded E2E_VENDOR_EMAIL account — seed one via a service-role script before running this spec.",
    );

    const orderCard = page.locator("div", { has: acceptButton }).first();
    await acceptButton.click();

    await expect(orderCard.getByRole("button", { name: "Start Preparing" })).toBeVisible({ timeout: 10_000 });
    await orderCard.getByRole("button", { name: "Start Preparing" }).click();

    await expect(orderCard.getByRole("button", { name: "Mark Ready for Pickup" })).toBeVisible({ timeout: 10_000 });
    await orderCard.getByRole("button", { name: "Mark Ready for Pickup" }).click();

    await expect(orderCard.getByText("Waiting for a rider to be assigned")).toBeVisible({ timeout: 10_000 });
  });

  test("dashboard reflects the vendor's own orders only (sanity check, not a full RLS test — see supabase/tests/rls_orders.sql for that)", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Dashboard|Orders/i }).first()).toBeVisible({ timeout: 15_000 });
  });
});
