import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E for changing who an open approval request is with.
// (docs/development/implemented/alpha-2/v0.26.0/approval-documents-and-reassignment.phase.md)
//
// Driven by CI (.github/workflows/e2e.yml) against a full stack — excluded from
// the vitest unit run. Uses the seeded fixture in
// apps/web/src/lib/e2e-fixtures-approval.ts:
//
//   seedApprovalSubjectSession — `Prepare instrument (conversational) →
//     Delegate sign-off (approved) → Finance sign-off (pending)`. The pending
//     row is the chained case: on a real run it is raised by the previous
//     approver, so the author sees a card they did not create.
//
// What is under test:
//
//   1. A sent request shows the approver by name, not "the approver" — which
//      needs `assignedApprover` off the suggest call, because a chained row is
//      assigned by user id and carries no email of its own.
//   2. Email approver is offered whether or not email is configured; chasing a
//      stalled request is a separate problem from email being unconfigured.
//   3. Update approver opens a picker, keeps the existing message for revision,
//      and moves the request without pulling the chat back a step.
//
// Reassignment is destructive to the seeded row's assignee, so the move itself
// runs last.

const seed = loadSeedFixtures();

test.describe.configure({ mode: "serial" });

test.describe("changing who an open request is with", () => {
  test("names the assigned approver on the sent card", async ({ page }) => {
    const sessionId = seed?.approvalSubjectSessionId;
    test.skip(!sessionId, "No seeded approval session — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);

    const gate = page.locator("[data-approval-gate]");
    await expect(gate).toBeVisible();

    // The row is already assigned, so the card opens in its sent state rather
    // than asking the author to pick anyone.
    await expect(gate.getByText(/awaiting approval/i)).toBeVisible();
    // Resolved server-side from the row. Before `assignedApprover` existed this
    // could only ever read "the approver".
    await expect(gate.getByText(/the approver/i)).toHaveCount(0);
  });

  test("offers Email approver on a sent request", async ({ page }) => {
    const sessionId = seed?.approvalSubjectSessionId;
    test.skip(!sessionId, "No seeded approval session — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator("[data-approval-gate]")).toBeVisible();

    await expect(page.locator("[data-approval-email]")).toBeVisible();
  });

  test("opens a picker that keeps the existing message for revision", async ({ page }) => {
    const sessionId = seed?.approvalSubjectSessionId;
    test.skip(!sessionId, "No seeded approval session — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator("[data-approval-gate]")).toBeVisible();

    const update = page.locator("[data-approval-update-approver]");
    test.skip(
      !(await update.isVisible().catch(() => false)),
      "Signed-in user does not own this chat, so cannot change the approver",
    );

    await update.click();

    const panel = page.locator("[data-approval-update-panel]");
    await expect(panel).toBeVisible();
    await expect(panel.getByPlaceholder(/search people/i)).toBeVisible();
    // Offered for revision rather than silently forwarded: a note naming the
    // previous approver would read oddly to the new one.
    await expect(panel.getByLabel(/message for the new approver/i)).toBeVisible();

    // Backing out leaves the request exactly as it was.
    await panel.getByRole("button", { name: /^cancel$/i }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator("[data-approval-gate]")).toBeVisible();
  });

  test("moves the request without pulling the chat back a step", async ({ page }) => {
    const sessionId = seed?.approvalSubjectSessionId;
    test.skip(!sessionId, "No seeded approval session — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator("[data-approval-gate]")).toBeVisible();

    const update = page.locator("[data-approval-update-approver]");
    test.skip(
      !(await update.isVisible().catch(() => false)),
      "Signed-in user does not own this chat, so cannot change the approver",
    );

    await update.click();
    const panel = page.locator("[data-approval-update-panel]");
    await panel.getByPlaceholder(/search people/i).fill("admin");

    const firstMatch = panel.locator("button", { hasText: "@" }).first();
    test.skip(
      !(await firstMatch.isVisible().catch(() => false)),
      "People search returned nobody to reassign to in this environment",
    );
    await firstMatch.click();
    await page.locator("[data-approval-update-confirm]").click();

    // The whole point: only the addressee moved. The session is still parked on
    // the approval node, so the gate is still up and the composer still absent.
    await expect(page.locator("[data-approval-update-panel]")).toBeHidden({ timeout: 15000 });
    await expect(page.locator("[data-approval-gate]")).toBeVisible();
    await expect(page.getByPlaceholder(/message wayfinder/i)).toHaveCount(0);

    // And the move is announced in the thread the author is watching.
    await expect(page.getByText(/reassigned/i).first()).toBeVisible();
  });
});
