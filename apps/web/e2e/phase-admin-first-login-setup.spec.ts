import { expect, test } from "./helpers/base";

// E2E for the admin first-login setup phase (ADR-041).
//
// Driven by the /e2e (Playwright MCP) skill against a running signed-in stack —
// excluded from the vitest unit run. The standard e2e stack already has an
// admin, which lets us exercise the user-visible contracts:
//
//   1. Step 1 forks on the one/multiple-organisation choice and Continue
//      commits it without a separate Save.
//   2. Step 2 blocks until each requirement passes its live connectivity test —
//      being "configured" is not enough, because the storage settings carry env
//      defaults that read as configured on a machine with no storage at all.
//   3. Skipping that step warns before exiting.
//   4. Once an admin exists the public /setup bootstrap screen self-disables.
//
// Step 3's completion screen has no e2e path: reaching it needs a passing AI
// connectivity probe, which runs server-side against the real provider API and
// so cannot pass with CI's placeholder key. Its gate logic is covered by
// `src/components/onboarding/wizard-requirements.test.ts`.

const SETTINGS_PATH = process.env.E2E_SETTINGS_PATH ?? "/admin/settings";

// Opens the wizard from admin Settings and returns its dialog container. The
// wizard reuses settings cards the page behind it also renders, so every element
// lookup has to be scoped to the dialog to stay unambiguous.
const openWizard = async (page: import("@playwright/test").Page) => {
  await page.goto(SETTINGS_PATH);
  await page.getByTestId("rerun-setup").click();
  return page.getByTestId("setup-wizard");
};

test.describe("admin first-login setup wizard", () => {
  test("step 1 forks on the deployment choice and Continue commits it", async ({ page }) => {
    const wizard = await openWizard(page);
    const title = page.getByTestId("setup-wizard-title");
    await expect(title).toContainText("Step 1 of 3: Deployment");

    // A fork, not a toggle: Continue stays disabled until a shape is picked.
    const continueButton = page.getByTestId("wizard-continue");
    await expect(continueButton).toBeDisabled();

    // Choosing "one organisation" reveals the reused organisation name card;
    // Continue saves it without a separate Save press.
    await page.getByTestId("wizard-deployment-single").click();
    await expect(wizard.locator("#org-name")).toBeVisible();
    await expect(continueButton).toBeEnabled();

    await continueButton.click();
    await expect(title).toContainText("Step 2 of 3: Required setup");
  });

  test("choosing multiple organisations asks which one the admin belongs to", async ({ page }) => {
    const wizard = await openWizard(page);

    await page.getByTestId("wizard-deployment-multi").click();

    const nameField = wizard.locator("#wizard-multi-org-name");
    await expect(nameField).toBeVisible();
    await expect(nameField).toHaveAttribute("placeholder", "e.g. Acme Corporation");

    // The single-organisation name card belongs to the other branch only — the
    // Settings page behind the wizard renders its own copy, so this is scoped.
    await expect(wizard.locator("#org-name")).toHaveCount(0);
  });

  test("the required step blocks until each requirement passes its live test", async ({ page }) => {
    const wizard = await openWizard(page);
    await page.getByTestId("wizard-deployment-single").click();
    await page.getByTestId("wizard-continue").click();
    await expect(page.getByTestId("setup-wizard-title")).toContainText("Step 2 of 3");

    // Storage reads as configured from its env defaults, but nothing has been
    // tested yet, so neither requirement is satisfied and Continue is blocked.
    const storage = page.getByTestId("wizard-requirement-storage");
    const ai = page.getByTestId("wizard-requirement-ai");
    await expect(storage).toHaveAttribute("data-state", "untested");
    await expect(ai).toHaveAttribute("data-satisfied", "false");
    await expect(page.getByTestId("wizard-continue")).toBeDisabled();

    // Testing storage against the stack's MinIO satisfies that half only.
    await wizard.getByTestId("test-connectivity-storage").click();
    await expect(storage).toHaveAttribute("data-satisfied", "true", { timeout: 15000 });
    await expect(page.getByTestId("wizard-continue")).toBeDisabled();
  });

  test("skipping the required step warns before leaving setup", async ({ page }) => {
    await openWizard(page);

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
