import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for the pieces that must never regress silently: the app
 * boots, the sign-in screen renders, protected areas redirect anonymous
 * visitors, and the API refuses unauthenticated calls.
 */

test("landing page renders the product", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/SkillTrack/i);
  await expect(page.locator("h1").first()).toBeVisible();
});

test("sign-in screen is reachable", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("an anonymous visitor cannot reach the admin console", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login|\/$/);
});

test("session APIs refuse anonymous callers", async ({ request }) => {
  const response = await request.get("/api/sessions/ses-anything/state");
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
});

test("profile API refuses anonymous callers", async ({ request }) => {
  const response = await request.get("/api/auth/me");
  expect(response.status()).toBe(401);
});
