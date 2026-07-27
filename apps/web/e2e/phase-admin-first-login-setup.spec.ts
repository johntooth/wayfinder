import { expect, test } from "./helpers/base";

// E2E for the admin first-login setup phase (ADR-041).
//
// Driven by the /e2e (Playwright MCP) skill against a running signed-in stack —
// excluded from the vitest unit run. The standard e2e stack already has an
// admin, which lets us exercise the user-visible contracts:
//
//   1. Happy path — the wizard is re-openable from admin Settings, forks on the
//      one/multiple-organisation choice, gates its required step on storage and
//      AI being configured, and finishes on a completion message.
//   2. Skip path — skipping the required step warns before exiting.
//   3. Error/self-disabling path — once an admin exists the public /setup
//      bootstrap screen is no longer reachable and redirects to sign-in.

const SETTINGS_PATH = process.env.E2E_SETTINGS_PATH ?? "/admin/settings";

test.describe("admin first-login setup wizard", () => {
  test("re-run setup walks the three steps and finishes", async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    // Re-run entry point (never clears the completion flag).
    await page.getByTestId("rerun-setup").click();

    const title = page.getByTestId("setup-wizard-title");
    await expect(title).toContainText("Step 1 of 3: Deployment");

    // Step 1 is a fork, not a toggle: Continue stays disabled until the admin
    // picks a deployment shape.
    const continueButton = page.getByTestId("wizard-continue");
    await expect(continueButton).toBeDisabled();

    // Choosing "one organisation" reveals the reused organisation name card;
    // Continue saves it without a separate Save press.
    await page.getByTestId("wizard-deployment-single").click();
    await expect(page.locator("#org-name")).toBeVisible();
    await expect(continueButton).toBeEnabled();

    await continueButton.click();
    await expect(title).toContainText("Step 2 of 3: Required setup");

    // Both requirements are satisfied in the e2e stack, so each shows the
    // configured indicator and Continue is available.
    await expect(page.getByTestId("wizard-requirement-storage")).toHaveAttribute(
      "data-satisfied",
      "true",
    );
    await expect(page.getByTestId("wizard-requirement-ai")).toHaveAttribute(
      "data-satisfied",
      "true",
    );

    await continueButton.click();
    await expect(title).toContainText("Step 3 of 3: Done");

    // The final step is a completion message only — no feature toggles, and no
    // skip. Synthesise Information ships on by default with nothing to opt into.
    await expect(page.getByTestId("wizard-complete")).toContainText("Setup complete");
    await expect(page.getByTestId("wizard-complete")).toContainText("Configuration pages");
    await expect(page.locator("#wizard-flag-skills")).toHaveCount(0);
    await expect(page.locator("#wizard-flag-mcp")).toHaveCount(0);
    await expect(page.getByTestId("wizard-skip")).toHaveCount(0);

    await page.getByTestId("wizard-finish").click();
    await expect(title).toHaveCount(0);
  });

  test("choosing multiple organisations asks which one the admin belongs to", async ({ page }) => {
    await page.goto(SETTINGS_PATH);
    await page.getByTestId("rerun-setup").click();

    await page.getByTestId("wizard-deployment-multi").click();

    const nameField = page.locator("#wizard-multi-org-name");
    await expect(nameField).toBeVisible();
    await expect(nameField).toHaveAttribute("placeholder", "e.g. Acme Corporation");

    // The single-organisation name card belongs to the other branch only.
    await expect(page.locator("#org-name")).toHaveCount(0);
  });

  test("skipping the required step warns before leaving setup", async ({ page }) => {
    await page.goto(SETTINGS_PATH);
    await page.getByTestId("rerun-setup").click();

    await page.getByTestId("wizard-deployment-single").click();
    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("setup-wizard-title")).toContainText("Step 2 of 3");

    await page.getByTestId("wizard-skip").click();

    // The warning states both that the settings are configurable later and that
    // the app is not functional until they are.
    await expect(page.getByTestId("wizard-skip-warning-title")).toBeVisible();
    const warning = page.getByRole("dialog").filter({ hasText: "Leave setup unfinished?" });
    await expect(warning).toContainText(/configure these settings at any time/i);
    await expect(warning).toContainText(/will not be functional/i);

    // Confirming exits the wizard entirely.
    await page.getByTestId("wizard-skip-confirm").click();
    await expect(page.getByTestId("setup-wizard-title")).toHaveCount(0);
  });

  test("the public /setup screen self-disables once an admin exists", async ({ page }) => {
    await page.goto("/setup?token=irrelevant");

    // With an admin already present, the bootstrap screen is not a setup surface
    // and routes the visitor to sign in instead.
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });
});
