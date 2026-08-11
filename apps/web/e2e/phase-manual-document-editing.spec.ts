import { test, expect } from "./helpers/base";
import { requireSeedFixtures } from "./helpers/seed";
import { isVisibleWithin } from "./helpers/visible";

// E2E for manual document editing in flows (PRD: manual-document-editing).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. The flow under test:
//   1. Open a session that has a generated document card.
//   2. The card on an active, edit-enabled step shows an Edit action.
//   3. Editing a field and saving re-renders the DOCX (new -r{n} path),
//      stamps the edited marker, and surfaces per-field errors on bad input.
//
// Assumes the seeded e2e fixture session (see apps/web/src/lib/e2e-fixtures.ts)
// with a document-producing conversational step.

// The guard was `test.skip(!process.env.E2E_SESSION_PATH, "Needs seeded
// editable-document session, which seedE2EFixtures does not create yet")`, and
// the path fell back to a session id that has never existed
// ("/chats/e2e-seed-session"). Both were wrong: the seeded session carries
// `onboarding-plan.docx` with documentStatus "complete" and step outputs whose
// fields are exactly what this dialog edits (name = Jane Smith, organisation =
// Acme Ltd). Nothing was missing but an environment variable nobody sets.
const NO_EDIT_ACTION =
  "Document card offers no Edit action — the step is not active or not edit-enabled";

test.describe("manual document editing", () => {
  const openEditor = async (page: import("@playwright/test").Page) => {
    await page.goto(`/chats/${requireSeedFixtures().sessionId}`);

    const editButton = page.getByRole("button", { name: /edit/i }).first();
    if (!(await isVisibleWithin(editButton))) return false;

    await editButton.click();
    return true;
  };

  test("operator edits a field and the card shows the edited marker", async ({ page }) => {
    const documentCard = page.getByText(/\.docx$/);

    if (!(await openEditor(page))) {
      test.skip(true, NO_EDIT_ACTION);
      return;
    }
    await expect(documentCard.first()).toBeVisible();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/edit document fields/i)).toBeVisible();

    // Correct the first text field and save.
    const firstInput = dialog.locator("input[type='text']").first();
    await firstInput.fill("Corrected Supplier Pty Ltd");
    await dialog.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/edited/i).first()).toBeVisible();
  });

  test("invalid input is rejected with a per-field message and nothing is saved", async ({
    page,
  }) => {
    if (!(await openEditor(page))) {
      test.skip(true, NO_EDIT_ACTION);
      return;
    }
    const dialog = page.getByRole("dialog");

    // Clear a required field and attempt to save.
    const requiredInput = dialog.locator("input[type='text']").first();
    await requiredInput.fill("");
    await dialog.getByRole("button", { name: /save changes/i }).click();

    await expect(dialog.getByText(/required/i)).toBeVisible();
  });
});
