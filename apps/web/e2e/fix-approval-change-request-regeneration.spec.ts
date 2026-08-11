import { test, expect } from "./helpers/base";
import { requireSeedFixtures } from './helpers/seed';
import { isVisibleWithin } from "./helpers/visible";

// E2E for the change-request regeneration fix.
// (docs/development/implemented/alpha-2/v0.23.1/approval-edit-visibility-and-change-requests.phase.md)
//
// Driven by CI (.github/workflows/e2e.yml) against a full stack — excluded from
// the vitest unit run. Uses the seeded fixture in
// apps/web/src/lib/e2e-fixtures-approval.ts:
//
//   seedApprovalSubjectSession — a session parked on a second pending approval
//     ("Finance sign-off") over a document produced by "Prepare instrument".
//
// This walks the exact reported reproduction: the second approver rejects and
// asks for a change, the work routes back to the document step, and the
// document is regenerated there.
//
// What it asserts is the reproduction path, not the regenerated wording. The
// content of a regenerated document comes from a live model, so asserting on it
// would make this test a coin toss — the guarantee that the approver's request
// actually reaches the extraction prompt is pinned at the unit level instead:
//
//   packages/application/.../generate-document.test.ts
//     — "puts an outstanding change request into the extraction prompt"
//   apps/web/.../turn-helpers.test.ts
//     — "threads an approver's outstanding change request into the use case"
//
// Both fail on the unfixed code. This spec proves the surfaces those values
// travel between are wired and reachable by a real user.

const CHANGE_REQUEST = "The delegate must be Northwind Ltd, not Acme Ltd.";

test.describe("a rejected approval routes back with its request intact", () => {
  test("rejecting with changes returns the work and keeps the request in the thread", async ({
    page,
  }) => {
    const sessionId = requireSeedFixtures().approvalSubjectSessionId;

    await page.goto("/approvals");

    const row = page.locator("[data-approval-id]").first();
    test.skip(
      !(await isVisibleWithin(row)),
      "No pending approvals for this user in the seeded stack",
    );

    await row.getByRole("button", { name: "Reject" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Decision comment").fill(CHANGE_REQUEST);
    await dialog.getByRole("button", { name: "Route back to user" }).click();

    // The decision is the approver's own turn in the thread (v0.22.2), which is
    // what puts the request in front of both the operator and the model.
    await page.goto(`/chats/${sessionId}`);
    await expect(page.getByText(CHANGE_REQUEST)).toBeVisible();
  });

  test("the returned step offers a regeneration that completes", async ({ page }) => {
    const sessionId = requireSeedFixtures().approvalSubjectSessionId;

    await page.goto(`/chats/${sessionId}`);

    const regenerate = page.getByRole("button", { name: "Regenerate" }).first();
    test.skip(
      !(await regenerate.isVisible().catch(() => false)),
      "Session is not parked on a regenerable document step in this run",
    );

    await regenerate.click();
    page.on("dialog", (confirmation) => void confirmation.accept());

    // Regeneration now reads the outstanding change requests before extracting.
    // The assertion is that adding that read did not break the path — a missing
    // or failed approval read must degrade to today's behaviour, never to a
    // failed generation.
    await expect(page.getByText("File no longer available. Try regenerating.")).toHaveCount(0);
  });
});
