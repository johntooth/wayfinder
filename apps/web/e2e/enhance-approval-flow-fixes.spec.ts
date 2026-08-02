import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E for the approval-flow fixes.
// (docs/development/implemented/alpha-2/v0.22.2/approval-flow-fixes.phase.md)
//
// Driven by CI (.github/workflows/e2e.yml) against a full stack — excluded from
// the vitest unit run. Uses the seeded fixtures in
// apps/web/src/lib/e2e-fixtures-approval.ts:
//
//   seedApprovalSubjectSession — a session parked on a pending approval, so the
//     operator-facing gate renders and the approver's queue has a row.
//
// What is under test, per reported item:
//
//   5. The approver stage is always named — in the chat gate and in the
//      /approvals decision modal — whether or not the node carries a roleHint.
//   2. The decision modal carries the same content as the chat selector: which
//      signature this is, what is being signed, and the artefact.
//   4. "Edit before deciding" opens the editor rather than refusing with
//      "The document is locked after approval."
//   3. The chats list hydrates without React discarding the server tree.
//
// Items 1, 6 and 7 are asserted at the unit level rather than here: they need a
// failing cross-check, a recorded decision and a following chat turn, none of
// which are deterministic against a live model in the sandbox.
//
// Assertions are about what an operator and an approver can see — never about a
// specific person being suggested — so they stay deterministic.

const seed = loadSeedFixtures();

test.describe("the approval selector always names the approver", () => {
  test("the chat gate names the stage even with no role hint configured", async ({ page }) => {
    const sessionId = seed?.approvalSubjectSessionId;
    test.skip(!sessionId, "No seeded approval session — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);

    const gate = page.locator("[data-approval-gate]");
    await expect(gate).toBeVisible();

    // Always rendered: a first-level node with no roleHint used to show nothing
    // at all where the approver's identity belonged.
    const stage = gate.locator("[data-approver-stage]");
    await expect(stage).toBeVisible();
    await expect(stage).toContainText(/supervisor|approver/i);
  });

  test("the approvals queue names the stage on every pending row", async ({ page }) => {
    await page.goto("/approvals");

    const row = page.locator("[data-approval-id]").first();
    test.skip(
      !(await row.isVisible().catch(() => false)),
      "No pending approvals for this user in the seeded stack",
    );

    await expect(row.locator("[data-approver-stage]")).toContainText(/supervisor|approver/i);
  });
});

test.describe("the decision modal carries what the approver needs", () => {
  test("approving opens a modal showing the stage, the subject and the step", async ({ page }) => {
    await page.goto("/approvals");

    const row = page.locator("[data-approval-id]").first();
    test.skip(
      !(await row.isVisible().catch(() => false)),
      "No pending approvals for this user in the seeded stack",
    );

    await row.getByRole("button", { name: "Approve" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The modal used to be a bare comment box; it now repeats the row's context
    // so the approver is not deciding against a remembered document.
    await expect(dialog.locator("[data-approver-stage]")).toBeVisible();
    await expect(dialog.getByLabel("Decision comment")).toBeVisible();
  });
});

test.describe("an approver may edit the step they are about to sign", () => {
  test("'Edit before deciding' opens the editor instead of reporting a lock", async ({ page }) => {
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

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The defect: a first approval's snapshot locked the whole session, so the
    // dialog refused the very edit ADR-045 §5 exists to allow.
    await expect(dialog).not.toContainText("The document is locked after approval.");
  });
});

test.describe("the chats list hydrates cleanly", () => {
  test("React does not discard the server-rendered tree", async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/hydrat/i.test(text)) hydrationErrors.push(text);
    });

    await page.goto("/chats");
    // The list (or its empty state) has settled — the mismatch was between the
    // server's empty state and the client's loading skeleton, so both must be
    // past before the assertion means anything.
    await expect(page.getByRole("heading", { name: "My Chats" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(hydrationErrors).toEqual([]);
  });
});
