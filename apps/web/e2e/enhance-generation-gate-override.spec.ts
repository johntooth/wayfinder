import { expect, test } from "@playwright/test";

// E2E for the admin-only, audited override of the document-generation gate.
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Assumes an authenticated admin storageState.
//
// Best-effort: it needs a session parked on a gate-blocked document step, so it
// skips when none is present rather than failing, to avoid CI flakiness.

test.describe("document-generation gate override (admin)", () => {
  test("a gate-blocked document step offers an audited Generate-anyway override to an admin", async ({
    page,
  }) => {
    await page.goto("/admin/sessions");

    const blockedRow = page.getByRole("row", { name: /document|draft|report|PIA/i }).first();
    const hasBlocked = await blockedRow.isVisible().catch(() => false);
    test.skip(!hasBlocked, "No gate-blocked session present to exercise the override.");

    await blockedRow.getByRole("link").first().click();

    const override = page.getByRole("button", { name: /generate anyway/i });
    const offered = await override.isVisible().catch(() => false);
    test.skip(!offered, "Session is not parked on a blocked document gate.");

    // The card frames the override as recorded, and clicking it clears the card.
    await expect(page.getByText(/recorded in the audit log/i)).toBeVisible();
    await override.click();
    await expect(override).toBeHidden();
  });
});
