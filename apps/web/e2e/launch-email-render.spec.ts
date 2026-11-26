import { expect, test } from "@playwright/test";
import { buildLaunchEmail, KIAKIA_PRODUCTION_URL } from "../../../supabase/functions/_shared/launch-email";

test("pre-launch emails fit a phone viewport and keep their primary action visible", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route(`${KIAKIA_PRODUCTION_URL}/**`, async (route) => {
    // Email artwork is decorative for this layout check; keep the test offline.
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/v0cAAAAASUVORK5CYII=", "base64"),
    });
  });

  for (const [kind, button] of [["welcome", "SEE THE COUNTDOWN"], ["announcement", "EXPLORE KIAKIA"]] as const) {
    const email = buildLaunchEmail(kind, `${KIAKIA_PRODUCTION_URL}/launch/unsubscribe?token=sample`);
    await page.setContent(email.html);
    await expect(page.getByRole("link", { name: button })).toBeVisible();
    await expect(page.getByRole("link", { name: "Unsubscribe" })).toBeVisible();

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }
});
