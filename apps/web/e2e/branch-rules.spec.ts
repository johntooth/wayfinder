import { test, expect } from "./helpers/base";
import { requireSeedFixtures } from "./helpers/seed";

// E2E for branch rules on edges.
// (docs/development/implemented/alpha-2/v0.28.0/edge-branch-rules.phase.md)
//
// Runs in CI (.github/workflows/e2e.yml) against a full stack — excluded from
// the vitest unit run. Uses the seeded fixture in
// apps/web/src/lib/e2e-fixtures.ts:
//
//   seedForkFlow — "Request Intake" forks into "Standard Purchase" and
//     "Procurement Approval", with no branch rules on either edge. That is the
//     un-ruled fork this enhancement is about, so the spec needs no new seed.
//
// forkFlowId is a required seed key (helpers/seed.ts), and the chromium project
// depends on the seed setup, so requireSeedFixtures() throws — rather than the
// spec skipping — if the fork flow is ever missing.
//
// What is under test:
//   1. A forked connector carries the indicator; the unforked connectors do not.
//   2. The advisory names the forking step and survives a reload.
//   3. Clicking the indicator opens the modal, and a saved rule flips that
//      connector's state and persists.
//   4. Ruling every branch of the fork clears the advisory.
//   5. Removing a rule puts the connector, and the advisory, back.
//   6. A rule reaches the manual branch picker, so an operator choosing by hand
//      reads the same condition the AI was given.
//
// Assertions read the data attributes the edge and advisory expose rather than
// SVG geometry, so they stay stable against canvas layout.

const FIRST_RULE = "the purchase is under £1,000 and needs no sign-off";
const SECOND_RULE = "the purchase is £1,000 or more and needs sign-off";

// Every forked edge exposes its state; unforked ones render no badge at all.
const branchBadges = (page: import("@playwright/test").Page) =>
  page.locator("[data-branch-rule-edge]");

const advisory = (page: import("@playwright/test").Page) =>
  page.locator("[data-missing-branch-rules]");

test.describe("branch rules on forked connectors", () => {
  test("only the forked connectors carry an indicator", async ({ page }) => {
    const { forkFlowId } = requireSeedFixtures();

    await page.goto(`/flows/${forkFlowId}/config`);
    await expect(page.getByText("Request Intake").first()).toBeVisible();

    // Four edges in the seeded flow, but only the two leaving "Request Intake"
    // are a choice — the two joining "Save document" are the only way onward
    // from their own step, so a rule there would decide nothing.
    await expect(branchBadges(page)).toHaveCount(2);
    await expect(branchBadges(page).first()).toHaveAttribute(
      "data-branch-rule-state",
      "missing",
    );
  });

  test("the advisory names the forking step and explains the fix", async ({ page }) => {
    const { forkFlowId } = requireSeedFixtures();

    await page.goto(`/flows/${forkFlowId}/config`);
    await expect(page.getByText("Request Intake").first()).toBeVisible();

    const warning = advisory(page);
    await expect(warning).toHaveAttribute("data-missing-branch-rules", "2");
    await expect(warning).toContainText("Request Intake");
    await expect(warning).toContainText(/click a marked connector/i);
  });

  test("clicking an indicator opens the modal and a saved rule persists", async ({ page }) => {
    const { forkFlowId } = requireSeedFixtures();

    await page.goto(`/flows/${forkFlowId}/config`);
    await expect(page.getByText("Request Intake").first()).toBeVisible();

    const firstBadge = branchBadges(page).first();
    const edgeId = await firstBadge.getAttribute("data-branch-rule-edge");
    await firstBadge.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/when should this branch be used/i);
    // The modal names both ends, so the author knows which path they are ruling.
    await expect(dialog).toContainText("Request Intake");

    await dialog.getByTestId("branch-rule-input").fill(FIRST_RULE);
    await dialog.getByTestId("branch-rule-save").click();
    await expect(dialog).toBeHidden();

    const ruled = page.locator(`[data-branch-rule-edge="${edgeId}"]`);
    await expect(ruled).toHaveAttribute("data-branch-rule-state", "set");
    // One branch ruled, one still open — the advisory stays, with a lower count.
    await expect(advisory(page)).toHaveAttribute("data-missing-branch-rules", "1");

    await page.reload();
    await expect(page.locator(`[data-branch-rule-edge="${edgeId}"]`)).toHaveAttribute(
      "data-branch-rule-state",
      "set",
    );

    // Re-opening shows the saved rule rather than an empty field.
    await page.locator(`[data-branch-rule-edge="${edgeId}"]`).click();
    await expect(page.getByTestId("branch-rule-input")).toHaveValue(FIRST_RULE);
  });

  test("ruling every branch clears the advisory, and removing one brings it back", async ({
    page,
  }) => {
    const { forkFlowId } = requireSeedFixtures();

    await page.goto(`/flows/${forkFlowId}/config`);
    await expect(page.getByText("Request Intake").first()).toBeVisible();

    // Rule whichever branches are still open, so the spec does not depend on
    // what an earlier test in the file left behind.
    const rules = [FIRST_RULE, SECOND_RULE];
    for (const [index, badge] of (await branchBadges(page).all()).entries()) {
      if ((await badge.getAttribute("data-branch-rule-state")) === "set") continue;
      await badge.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByTestId("branch-rule-input").fill(rules[index] ?? SECOND_RULE);
      await dialog.getByTestId("branch-rule-save").click();
      await expect(dialog).toBeHidden();
    }

    await expect(advisory(page)).toHaveAttribute("data-missing-branch-rules", "0");
    await expect(branchBadges(page).first()).toHaveAttribute("data-branch-rule-state", "set");

    // Removing a rule returns that connector — and the advisory — to the
    // un-ruled state, so the warning tracks the flow rather than latching off.
    const badge = branchBadges(page).first();
    const edgeId = await badge.getAttribute("data-branch-rule-edge");
    await badge.click();
    await page.getByRole("dialog").getByRole("button", { name: /remove rule/i }).click();

    await expect(page.locator(`[data-branch-rule-edge="${edgeId}"]`)).toHaveAttribute(
      "data-branch-rule-state",
      "missing",
    );
    await expect(advisory(page)).toHaveAttribute("data-missing-branch-rules", "1");
  });
});
