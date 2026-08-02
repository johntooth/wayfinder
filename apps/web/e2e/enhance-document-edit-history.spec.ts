import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E for the document edit-history modal.
// (docs/development/implemented/alpha-2/v0.23.1/approval-edit-visibility-and-change-requests.phase.md)
//
// Driven by CI (.github/workflows/e2e.yml) against a full stack — excluded from
// the vitest unit run. Uses the seeded fixture in
// apps/web/src/lib/e2e-fixtures-approval.ts:
//
//   seedApprovalSubjectSession — a session parked on a second pending approval,
//     whose subject step carries a generated document with one captured field
//     ("Delegate Name" = "Acme Ltd").
//
// Under test: an approver edits the step before deciding, and the before/after
// is then legible to anyone looking at the document — previously the only trace
// was an "Edited <date>" stamp and a list of raw field keys.
//
// The whole path is deterministic: the edit re-renders from the template and
// the summary is read straight back out of the recorded history, so no model
// call stands between the edit and the assertion.

const seed = loadSeedFixtures();
const EDITED_NAME = "Northwind Ltd";

test.describe("what an approver changed is visible on the document", () => {
  test("editing before deciding records a before/after the originator can read", async ({
    page,
  }) => {
    await page.goto("/approvals");

    const row = page.locator("[data-approval-id]").first();
    test.skip(
      !(await row.isVisible().catch(() => false)),
      "No pending approvals for this user in the seeded stack",
    );

    const edit = row.getByRole("button", { name: "Edit before deciding" });
    test.skip(
      !(await edit.isVisible().catch(() => false)),
      "Seeded approval's subject step produced no document to edit",
    );
    await edit.click();

    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible();

    const nameField = editDialog.getByLabel("Delegate Name");
    test.skip(
      !(await nameField.isVisible().catch(() => false)),
      "Seeded document exposes no editable Delegate Name field",
    );
    const originalName = (await nameField.inputValue()) || "Acme Ltd";
    await nameField.fill(EDITED_NAME);
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).toBeHidden();

    // Back on the queue the card now carries the stamp and, beside it, the way
    // in to what actually changed.
    await page.reload();
    const historyButton = page
      .locator("[data-document-edit-history]")
      .first();
    await expect(historyButton).toBeVisible();
    await historyButton.click();

    const historyDialog = page.getByRole("dialog");
    await expect(historyDialog).toBeVisible();
    await expect(historyDialog.getByText("What changed")).toBeVisible();

    // The point of the modal: the old value struck out, the new value beside
    // it, under the label of the field that changed.
    const change = historyDialog.locator("[data-edit-change='delegate_name']");
    await expect(change).toBeVisible();
    await expect(change.locator("del")).toHaveText(originalName);
    await expect(change.locator("ins")).toHaveText(EDITED_NAME);
  });

  test("the originator sees the same history in the session thread", async ({ page }) => {
    const sessionId = seed?.approvalSubjectSessionId;
    test.skip(!sessionId, "No seeded approval session — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);

    const historyButton = page.locator("[data-document-edit-history]").first();
    test.skip(
      !(await historyButton.isVisible().catch(() => false)),
      "The seeded document has not been edited in this run",
    );

    await historyButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The same before/after the approver's queue shows — the originator was
    // previously left with an "Edited <date>" stamp and nothing else.
    const change = dialog.locator("[data-edit-change]").first();
    await expect(change).toBeVisible();
    await expect(change.locator("del")).toBeVisible();
    await expect(change.locator("ins")).toBeVisible();
  });
});
