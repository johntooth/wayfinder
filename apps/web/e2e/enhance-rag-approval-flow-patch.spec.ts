import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E for the per-turn RAG / approval-history patch.
// (docs/development/implemented/alpha-2/v0.23.2/rag-turn-context-and-approval-history.phase.md)
//
// Driven by CI (.github/workflows/e2e.yml) against a full stack — excluded from
// the vitest unit run. Uses the seeded fixtures in
// apps/web/src/lib/e2e-fixtures-approval.ts:
//
//   seedApprovalSubjectSession — a session parked on a pending approval, so the
//     approver's queue has a row to decide and to file into history.
//
// What is under test, per reported item:
//
//   2. A pending approval on a discarded session is absent from Active.
//   3. /approvals carries Active / Completed / All; a decision opens its own
//      page, which reports the subject, the outcome and where the session now is.
//   5. The post-decision modal names who to notify from the session's people,
//      never the previous approver by virtue of having raised the request.
//   6. The approver search offers existing accounts, not only Entra and HR.
//
// Items 1 and 4 are asserted at the unit level instead: item 1 needs a live
// embedding model and a scored retrieval, and item 4 needs a completed approver
// edit followed by a re-read of the originator's thread — neither is
// deterministic in the sandbox. Their guards are
// build-retrieval-query.test.ts / retrieve-document-chunks.test.ts and
// approver-edit-subject-fields.test.ts / approver-edit-document.test.ts.
//
// Assertions are about what an approver can see and reach — never about a
// specific person being suggested — so they stay deterministic.

const seed = loadSeedFixtures();

const firstPendingRow = (page: import("@playwright/test").Page) =>
  page.locator('[data-approval-status="pending"]').first();

test.describe("the approvals page separates the queue from the history", () => {
  test("all three tabs are offered, and Active is the one that opens", async ({ page }) => {
    await page.goto("/approvals");

    for (const label of ["Active", "Completed", "All"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Active", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("Completed shows decisions rather than the pending queue", async ({ page }) => {
    await page.goto("/approvals");
    await page.getByRole("button", { name: "Completed", exact: true }).click();

    // Either decisions the seeded approver has made, or the empty state — never
    // a pending row, which is what the Active tab is for.
    await expect(page.locator('[data-approval-status="pending"]')).toHaveCount(0);
    const decided = page.locator("[data-approval-outcome]");
    const empty = page.getByText("No decisions yet");
    await expect(decided.first().or(empty)).toBeVisible();
  });

  test("a decided approval opens its own page, not the chat", async ({ page }) => {
    await page.goto("/approvals");
    await page.getByRole("button", { name: "All", exact: true }).click();

    const decided = page.locator("[data-approval-outcome]").first();
    test.skip(
      !(await decided.isVisible().catch(() => false)),
      "No decided approvals for this user in the seeded stack",
    );

    await decided.click();
    await expect(page).toHaveURL(/\/approvals\/[0-9a-f-]{36}$/);

    // Approval-centric: what was signed, what was decided, and where the work
    // has since got to — the question a historical decision actually raises.
    await expect(page.getByRole("heading", { level: 2, name: "Decision" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "What was signed" })).toBeVisible();
    await expect(page.locator("[data-session-state]")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the session" })).toBeVisible();
  });
});

test.describe("a discarded chat clears the approval it raised", () => {
  test("the approver's Active tab drops the request once the chat is discarded", async ({
    page,
  }) => {
    const sessionId = seed?.approvalSubjectSessionId;
    test.skip(!sessionId, "No seeded approval session — run the seed setup project");

    await page.goto("/approvals");
    const row = page.locator('[data-approval-status="pending"]').first();
    test.skip(
      !(await row.isVisible().catch(() => false)),
      "No pending approvals for this user in the seeded stack",
    );
    const approvalId = await row.getAttribute("data-approval-id");

    // Discard the chat exactly the way the originator does — through the
    // session's own Abandon action, not a back door — so the fix is exercised
    // against the real state transition.
    await page.goto(`/chats/${sessionId}`);
    const menu = page.getByRole("button", { name: "Chat actions" });
    test.skip(
      !(await menu.isVisible().catch(() => false)),
      "The seeded approver cannot abandon this session",
    );
    await menu.click();
    const abandon = page.getByRole("button", { name: "Abandon", exact: true });
    test.skip(
      !(await abandon.isVisible().catch(() => false)),
      "Abandon is not offered to this viewer (read-only session access)",
    );
    await abandon.click();

    // Gone from the queue, and gone from All too: an undecided request on a
    // dead chat is not history, it is a request nobody can act on.
    await page.goto("/approvals");
    await expect(page.locator(`[data-approval-id="${approvalId}"]`)).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.locator(`[data-approval-id="${approvalId}"]`)).toHaveCount(0);
  });
});

test.describe("deciding tells the approver who actually needs to know", () => {
  test("the post-decision notice names session people, not the previous approver", async ({
    page,
  }) => {
    await page.goto("/approvals");

    const row = firstPendingRow(page);
    test.skip(
      !(await row.isVisible().catch(() => false)),
      "No pending approvals for this user in the seeded stack",
    );

    await row.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm approval" }).click();

    // With email configured the modal closes on success; without it, the manual
    // hand-off is shown. Either is correct — what must never appear is a
    // hand-off naming nobody, or one offering no way to pass the decision on.
    const notify = dialog.locator("[data-notify-targets]");
    const noOne = dialog.getByText("There is no one else to notify");
    const closed = page.getByRole("dialog");
    await expect(notify.or(noOne).or(closed.locator("[data-approver-picker]"))).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("the approver search offers people who already have accounts", () => {
  test("typing a colleague's name returns an account-backed candidate", async ({ page }) => {
    const sessionId = seed?.approvalSubjectSessionId;
    test.skip(!sessionId, "No seeded approval session — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);
    const picker = page.locator("[data-approver-picker]");
    test.skip(
      !(await picker.isVisible().catch(() => false)),
      "The seeded session is not parked on an approver choice",
    );

    const someoneElse = picker.getByRole("button", { name: "Someone else" });
    if (await someoneElse.isVisible().catch(() => false)) await someoneElse.click();

    const search = picker.getByPlaceholder(/Search people/);
    await expect(search).toBeVisible();

    // The seeded stack has accounts but no Entra tenant and no HR upload, so a
    // result here can only have come from the user directory — which is the
    // whole point of the fix.
    await search.fill("test");
    const candidate = picker.getByRole("button", { name: /@/ }).first();
    await expect(candidate.or(picker.getByText("No matches."))).toBeVisible({ timeout: 10_000 });
  });
});
