import { expect, test } from "@playwright/test";

// E2E for the experimentation login bypass (enhance: auth-bypass).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack started with
// AUTH_BYPASS=true (and NODE_ENV != production) — excluded from the vitest unit
// run. The behaviour under test:
//   1. With the bypass on, navigating to a protected route never lands on the
//      login screen — the middleware mints a seed-admin session via
//      /api/auth/bypass and bounces the user straight into the app.
//   2. A session cookie is present afterwards, proving a real session was minted
//      (not merely a guard skipped), so every downstream API guard also passes.
//
// The assertions are the "no /login" contract plus cookie presence, so they hold
// regardless of which flow/session data exists in the sandbox.
test.describe("auth bypass", () => {
  test("a protected route loads authenticated without showing the login screen", async ({
    page,
  }) => {
    await page.goto("/chats");

    // The middleware → /api/auth/bypass → /chats hops resolve before the page
    // settles; the one place we must never end up is the login screen.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/chats/);
  });

  test("the bypass mints a real session cookie", async ({ page, context }) => {
    await page.goto("/");

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((cookie) =>
      cookie.name.endsWith("session_token"),
    );

    expect(sessionCookie?.value).toBeTruthy();
  });
});
