import { test, expect } from "./helpers/base";

// The mcp and skills feature flags default OFF on a fresh install (ADR-041 §4):
// they are surfaced as toggles in the first-run setup wizard and in admin, but
// nothing enables them automatically. The E2E fixtures turn both on during
// seeding, so by the time this spec runs their gated nav entries must render —
// which is what proves the flag -> nav wiring still works end to end.
//
// Driven by the /e2e (Playwright MCP) skill against a running signed-in stack
// as an admin user.

const ADMIN_HOME_PATH = process.env.E2E_ADMIN_HOME_PATH ?? "/admin/sessions";

test.describe("mcp + skills feature flags", () => {
  test("Skills and MCP Servers nav entries render once the flags are enabled", async ({
    page,
  }) => {
    await page.goto(ADMIN_HOME_PATH);

    // Both nav entries live under the "Advanced Flow Settings" group, which is
    // collapsed by default — expand it first.
    await page.getByRole("button", { name: /Advanced Flow Settings/i }).click();
    await expect(page.getByRole("link", { name: "Skills", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "MCP Servers", exact: true }).first()).toBeVisible();
  });
});
