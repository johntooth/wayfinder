import { test, expect } from "./helpers/base";
import { requireSeedFixtures } from './helpers/seed';

// E2E for the chained approval gate showing an unsent card for a request the
// previous approver had already sent.
// (docs/development/implemented/alpha-2/v0.26.1/fix-chained-gate-shows-unsent.md)
//
// Driven by CI (.github/workflows/e2e.yml) against a full stack — excluded from
// the vitest unit run. Uses the seeded fixture in
// apps/web/src/lib/e2e-fixtures-approval.ts:
//
//   seedApprovalSubjectSession — `Prepare instrument (conversational) →
//     Delegate sign-off (approved) → Finance sign-off (pending, assigned)`.
//     The pending row is already assigned, which is the state the originator's
//     gate used to render as "Choose the approver".
//
// The reported symptom, asserted directly: the gate for an already-assigned
// approval must render the *sent* card — named approver and the manage actions —
// and must offer neither the approver search nor a Confirm button, because a
// Confirm from a stale card would overwrite the approver someone else set.


test.describe("a chained approval that has already been sent", () => {
  test("renders the sent card, not an invitation to choose", async ({ page }) => {
    const sessionId = requireSeedFixtures().approvalSubjectSessionId;

    await page.goto(`/chats/${sessionId}`);

    const gate = page.locator("[data-approval-gate]");
    await expect(gate).toBeVisible();

    // The symptom, stated as the assertion: the unsent heading must not appear
    // for a row that carries an approver.
    await expect(gate.getByText(/choose the approver/i)).toHaveCount(0);
    await expect(gate.getByText(/awaiting approval/i)).toBeVisible();
  });

  test("names the approver rather than saying 'the approver'", async ({ page }) => {
    const sessionId = requireSeedFixtures().approvalSubjectSessionId;

    await page.goto(`/chats/${sessionId}`);
    const gate = page.locator("[data-approval-gate]");
    await expect(gate).toBeVisible();

    // Resolved from the row server-side. The suggestion-derived fallback this
    // replaces could only ever produce the generic phrase for a row assigned by
    // user id, which is exactly how a chained approval is assigned.
    await expect(gate.getByText(/awaiting approval/i)).toBeVisible();
    await expect(gate.getByText(/sent to the approver\.?$/i)).toHaveCount(0);
  });

  // The hazard behind the display fault: a Confirm on a stale card wrote
  // `approverUserId` unconditionally, silently replacing the approver the
  // previous approver had already sent to.
  test("offers no approver search or Confirm on an assigned request", async ({ page }) => {
    const sessionId = requireSeedFixtures().approvalSubjectSessionId;

    await page.goto(`/chats/${sessionId}`);
    const gate = page.locator("[data-approval-gate]");
    await expect(gate).toBeVisible();

    await expect(gate.getByPlaceholder(/search people/i)).toHaveCount(0);
    await expect(gate.getByRole("button", { name: /^confirm( & send)?$/i })).toHaveCount(0);
  });

  test("offers the manage actions instead", async ({ page }) => {
    const sessionId = requireSeedFixtures().approvalSubjectSessionId;

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator("[data-approval-gate]")).toBeVisible();

    // Chasing it is available to anyone on the card; changing it is the
    // originator's recourse where Withdraw does not apply to them.
    await expect(page.locator("[data-approval-email]")).toBeVisible();
    await expect(page.locator("[data-approval-update-approver]")).toBeVisible();
  });
});
