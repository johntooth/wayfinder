import { test, expect } from "./helpers/base";
import { selectFlowInSelector } from "./helpers/flow-selector";

// E2E for fork-sibling field consolidation in Flow Insights
// (phase: fork-field-consolidation).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. The flow under test is the seeded "E2E SEED Fork
// Flow" (see apps/web/src/lib/e2e-fixtures.ts): Request Intake forks into a
// Standard Purchase and a Procurement Approval branch, both capturing the same
// `amount` field, then rejoins at Save document. Two sessions each populate one
// branch.
//
//   1. By default the insights table shows ONE combined "Amount" column whose
//      subtext names both contributing branch steps.
//   2. Turning "Combine forked steps" off splits it back into per-step columns.

const FLOWS_DASHBOARD_PATH = process.env.E2E_FLOWS_DASHBOARD_PATH ?? "/admin/dashboards/flows";
const FORK_FLOW_NAME = "E2E SEED Fork Flow";

// The guard here used to be `test.skip(!process.env.E2E_FLOWS_DASHBOARD_PATH,
// "Needs seeded fork-flow dashboard data, which seedE2EFixtures does not create
// yet")`. That reason was false: seedForkFlow builds this exact flow — Request
// Intake forking to Standard Purchase and Procurement Approval, rejoining at
// Save document — and then starts *two sessions, each capturing `amount` on one
// branch* ($1,500 and $2,750), which is precisely what the preamble above
// describes. Nothing was missing but an environment variable nobody sets.
//
// The flow is reached through selectFlowInSelector because only the first five
// flows render as cards (FLOW_CARD_THRESHOLD) and the seed creates nine; a bare
// getByRole("button", { name }) finds it only when it happens to land in the
// top five.
test.describe("fork-sibling field consolidation", () => {
  test("two fork branches sharing a field render as one combined column by default", async ({
    page,
  }) => {
    await page.goto(FLOWS_DASHBOARD_PATH);

    const selection = await selectFlowInSelector(page, FORK_FLOW_NAME);
    if (!selection.selected) {
      test.skip(true, `Fork flow not selectable — ${selection.reason}`);
      return;
    }

    // One "Amount" column header, annotated with both contributing step names.
    const amountHeaders = page.getByRole("columnheader", { name: /amount/i });
    await expect(amountHeaders).toHaveCount(1);
    await expect(page.getByText("Standard Purchase · Procurement Approval")).toBeVisible();
  });

  test("turning off 'Combine forked steps' splits the column back per step", async ({ page }) => {
    await page.goto(FLOWS_DASHBOARD_PATH);

    const selection = await selectFlowInSelector(page, FORK_FLOW_NAME);
    if (!selection.selected) {
      test.skip(true, `Fork flow not selectable — ${selection.reason}`);
      return;
    }

    await page.getByRole("checkbox", { name: /combine forked steps/i }).uncheck();

    // Now one Amount column per branch step.
    await expect(page.getByRole("columnheader", { name: /amount/i })).toHaveCount(2);
  });
});
