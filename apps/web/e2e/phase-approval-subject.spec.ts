import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E for the approval subject / signature / routing phase.
// (docs/development/implemented/alpha-2/v0.22.0/approval-subject.phase.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Assumes the seeded fixtures in
// apps/web/src/lib/e2e-fixtures.ts:
//
//   seedApprovalSubjectSession — `Prepare instrument (2 signature slots) →
//     Delegate sign-off (approved) → Finance sign-off (pending)`, with the
//     session's checkpoint deliberately pointing `advancedFrom` at the *first
//     approval*. The pending finance approval is assigned to the signed-in user.
//
//   seedApprovalFirstFlow — a flow whose first step is an approval, so the
//     config editor has an authoring-time warning to show.
//
// What is under test:
//   1. The approver's card states what is being approved, resolved from the
//      node's configured subject.
//   2. The second approver is shown the *document*, not the first approval's
//      decision fields — the ADR-040 §2 defect, reachable with two approvals in
//      sequence and the exact shape the fixture seeds.
//   3. An approver can open the field editor before deciding (ADR-045).
//   4. Error path: configuring an approval with no editable step before it
//      warns the author that a change request will hold the session, rather
//      than leaving it to be discovered at decision time (ADR-044 §2).
//
// Assertions are about what the operator, approver and author can see, never
// about a specific email being delivered, so they stay deterministic.

const APPROVALS_PATH = process.env.E2E_APPROVALS_PATH ?? "/approvals";
const seed = loadSeedFixtures();
const SUBJECT_CHAT_NAME = "E2E SEED Approval Subject Session";
const SUBJECT_DOCUMENT = "delegation-instrument.docx";
const SUBJECT_STEP_NAME = "Prepare instrument";

const subjectCard = (page: import("@playwright/test").Page) =>
  page
    .locator("[data-approval-status='pending']")
    .filter({ hasText: SUBJECT_CHAT_NAME })
    .first();

test.describe("approval subject, signature and routing", () => {
  test("the approver is told what they are approving", async ({ page }) => {
    await page.goto(APPROVALS_PATH);

    const card = subjectCard(page);
    test.skip(
      !(await card.isVisible().catch(() => false)),
      "No seeded subject approval is awaiting this user",
    );

    await expect(card.getByText(/You are approving:/i)).toBeVisible();
    // Resolved from `approvalSubject`, which names the document step.
    await expect(card.getByText(new RegExp(SUBJECT_STEP_NAME, "i"))).toBeVisible();
  });

  test("a second approver sees the document, not the first approval's decision fields", async ({
    page,
  }) => {
    await page.goto(APPROVALS_PATH);

    const card = subjectCard(page);
    test.skip(
      !(await card.isVisible().catch(() => false)),
      "No seeded subject approval is awaiting this user",
    );

    // The document card the chat uses, at the revision carrying the first
    // approver's signature.
    await expect(card.getByText(SUBJECT_DOCUMENT)).toBeVisible();
    // The projected decision fields of the preceding approval — what
    // `advancedFrom` used to resolve to, and what must never appear here.
    await expect(card.getByText("Decided by", { exact: false })).toHaveCount(0);
    await expect(card.getByText("Outcome", { exact: false })).toHaveCount(0);
  });

  test("an approver can edit the subject step before deciding", async ({ page }) => {
    await page.goto(APPROVALS_PATH);

    const card = subjectCard(page);
    test.skip(
      !(await card.isVisible().catch(() => false)),
      "No seeded subject approval is awaiting this user",
    );

    await card.getByRole("button", { name: /edit before deciding/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/edit before deciding/i).first()).toBeVisible();
    // A signature slot is never offered for editing — it is filled by the
    // approval step, and an editable one is a forgeable one (ADR-043 §2).
    await expect(dialog.getByText(/delegate signature/i)).toHaveCount(0);
    await expect(dialog.getByText(/finance signature/i)).toHaveCount(0);
  });

  test("configuring an approval with nothing editable before it warns the author", async ({
    page,
  }) => {
    const flowId = seed?.approvalFirstFlowId;
    test.skip(!flowId, "No seeded approval-first flow — run the seed setup project");

    await page.goto(`/flows/${flowId}/config`);

    const node = page.getByText("Immediate sign-off").first();
    test.skip(
      !(await node.isVisible().catch(() => false)),
      "Seeded approval-first flow did not render",
    );
    await node.dblclick();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/On changes requested, return to/i)).toBeVisible();
    // The whole point of surfacing it here: better learned while editing the
    // flow than when an approver's change request has nowhere to go.
    await expect(dialog.getByText(/hold the session here/i)).toBeVisible();
  });

  test("the approval config offers a subject and defaults to the last completed step", async ({
    page,
  }) => {
    const flowId = seed?.approvalFirstFlowId;
    test.skip(!flowId, "No seeded approval-first flow — run the seed setup project");

    await page.goto(`/flows/${flowId}/config`);

    const node = page.getByText("Immediate sign-off").first();
    test.skip(
      !(await node.isVisible().catch(() => false)),
      "Seeded approval-first flow did not render",
    );
    await node.dblclick();

    const dialog = page.getByRole("dialog");
    const subjectKind = dialog.getByLabel(/What is being approved/i);
    await expect(subjectKind).toBeVisible();
    await expect(subjectKind).toHaveValue("step");

    // An untouched node opens on the default, so it keeps behaving exactly as
    // it did before the feature existed.
    await expect(dialog.getByLabel(/Which step\?/i)).toHaveValue("");

    // Switching to a described subject reveals the free-text instruction.
    await subjectKind.selectOption("custom");
    await expect(dialog.getByLabel(/Describe the subject/i)).toBeVisible();
  });
});
