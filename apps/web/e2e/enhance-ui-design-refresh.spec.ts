import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./helpers/base";

// E2E for the UI design refresh.
// (docs/development/implemented/alpha-2/v0.23.3/ui-design-refresh.phase.md)
//
// Covers only the behaviour that actually moved. The palette and type changes
// are not asserted here — pinning hex values in an e2e suite makes every future
// design tweak a test failure, and contrast is already guarded numerically by
// src/lib/design-tokens.test.ts and at runtime by accessibility.spec.ts.
//
// What moved, and is therefore tested:
//   1. The help control left the fixed viewport corner for the sidebar rail.
//   2. The chat header absorbed the step rail — one block, not two bands.
//   3. Sign out moved behind the user chip's account menu.
//   4. The rail becomes a drawer below the (newly lowered) 640px breakpoint.
//   5. /login was restructured, and was not previously covered by axe.

const SEED_SESSION_TITLE = "E2E SEED Session";

test.describe("UI design refresh", () => {
  test("the help control lives inside the sidebar, not the viewport corner", async ({ page }) => {
    await page.goto("/chats");

    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();

    // Scoped to the rail: this is the whole point of the move. A help button
    // still floating over page content would not match this locator.
    const help = sidebar.getByRole("button", { name: /help/i });
    await expect(help).toBeVisible();

    await help.click();
    await expect(page.getByRole("menuitem", { name: /about/i })).toBeVisible();
  });

  test("the chat header carries the title and the step rail in one block", async ({ page }) => {
    await page.goto("/chats");

    const seededChat = page.getByText(SEED_SESSION_TITLE).first();
    test.skip(
      !(await seededChat.isVisible().catch(() => false)),
      "No seeded chat available — chats list is empty",
    );
    await seededChat.click();

    const header = page.getByTestId("app-header");
    await expect(header).toBeVisible();

    // Title on line one, breadcrumb back to the list beside it.
    await expect(header.getByRole("heading")).toBeVisible();
    await expect(header.getByRole("link", { name: "My Chats" })).toBeVisible();

    // Line two: the step rail is now a descendant of the header rather than a
    // sibling band below it. Scoping the locator to the header is what proves
    // the consolidation — and the old standalone band must be gone entirely.
    await expect(header.getByTestId("step-rail-inline")).toBeVisible();
    await expect(page.getByTestId("step-rail-band")).toHaveCount(0);
  });

  test("sign out is reachable from the user chip's account menu", async ({ page }) => {
    await page.goto("/chats");

    const accountButton = page.getByRole("button", { name: /account menu/i });
    await expect(accountButton).toBeVisible();
    await accountButton.click();

    // Asserted, not clicked — signing out here would invalidate the shared
    // storageState the rest of the chromium project depends on.
    await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /settings/i })).toBeVisible();
  });

  test("below 640px the rail collapses into a drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/chats");

    await expect(page.getByTestId("app-sidebar")).toBeHidden();

    await page.getByRole("button", { name: /open navigation/i }).click();

    const drawer = page.getByTestId("app-sidebar-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: /my chats/i })).toBeVisible();

    await drawer.getByRole("button", { name: /close menu/i }).click();
    await expect(drawer).toBeHidden();
  });
});

// The authenticated accessibility suite cannot reach /login, so the restructured
// sign-in screen would otherwise ship unchecked.
test.describe("signed-out sign-in screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the rebuilt login screen has no axe violations", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading").first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(
      results.violations,
      `axe found ${results.violations.length} violation(s) on /login:\n\n${results.violations
        .map((violation) => `${violation.id}: ${violation.help}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
