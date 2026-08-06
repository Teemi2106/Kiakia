import { expect, test } from "@playwright/test";
import { e2eEnv, loginAs } from "./fixtures";

// Golden path: login -> browse -> add an item to cart -> checkout. Stops at
// the "Pay with Monnify" submit rather than following it through Monnify's
// hosted checkout — a real payment capture depends on Monnify's sandbox UI
// and our webhook, which is Vitest-covered separately
// (src/app/api/webhooks/monnify/route.test.ts). This proves the app-side
// half of the flow actually works end-to-end against a real Supabase
// project: real auth, real RLS-scoped cart writes, real place_order() call.
test.describe("customer: browse to checkout", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, e2eEnv.customerEmail, e2eEnv.customerPassword);
  });

  test("can add a menu item to the cart and reach the Monnify payment step", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 9.05, longitude: 7.45 });

    await page.goto("/home");
    const firstVendor = page.locator('a[href^="/vendors/"]').first();
    await expect(firstVendor).toBeVisible({ timeout: 15_000 });
    await firstVendor.click();

    await expect(page).toHaveURL(/\/vendors\//);
    const addButton = page.getByRole("button", { name: /^Add / }).first();
    await expect(addButton).toBeVisible({ timeout: 15_000 });
    await addButton.click();

    await page.getByRole("button", { name: /Add to cart/ }).click();

    const viewCartBar = page.getByRole("link", { name: /View Cart/ });
    await expect(viewCartBar).toBeVisible();
    await viewCartBar.click();

    await expect(page).toHaveURL(/\/cart/);
    await page.getByRole("link", { name: /Proceed to Checkout/ }).click();

    await expect(page).toHaveURL(/\/checkout/);

    // Only fill the new-address form if there's no saved address already
    // selected by default (CheckoutForm.tsx defaults to the first/default
    // saved address when the seeded customer has one).
    const newAddressRadio = page.getByRole("radio", { name: "Use a new address" });
    if (await newAddressRadio.isVisible().catch(() => false)) {
      await newAddressRadio.check();
      await page.getByLabel("Address", { exact: true }).fill("1 E2E Test Street");
      await page.getByRole("button", { name: /Use my current location/ }).click();
      await expect(page.getByText("Location captured")).toBeVisible({ timeout: 10_000 });
    }

    await page.getByRole("button", { name: /Pay with Monnify/ }).click();

    // A successful placeOrderAction always redirects away from /checkout —
    // either to Monnify's hosted checkout, or (if Monnify init fails) to
    // the order's own detail page. Either is a legitimate outcome; landing
    // back on /checkout with an inline error is the only failure.
    await expect(page).not.toHaveURL(/\/checkout$/, { timeout: 20_000 });
  });
});
