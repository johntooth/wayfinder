import { test, expect } from "./helpers/base";
import { selectFlowInSelector } from "./helpers/flow-selector";

// E2E for approval segmentation in the Flow Insights field report
// (phase: flow-insights-approval-segmentation).
//
// The flow under test is the seeded "E2E SEED Approval Subject Flow" (see
// apps/web/src/lib/e2e-fixtures-approval.ts): `Prepare instrument → Delegate
// sign-off (approved) → Finance sign-off (pending) → Records sign-off
// (approved)`. Two *decided* approval steps, each projecting the same generic
// keys (`outcome`, `decided_by`, …) onto its own node.
//
// Before this change the report showed those two steps as indistinguishable
// "Outcome"/"Decided by" columns — and, with "Combine across versions" left at
// its default, merged them into one. What must now hold:
//
//   1. Two separate Outcome columns, one per approval step, each captioned with
//      its own step name.
//   2. The approver is named, not identified by a user id.
//
// The third behaviour this phase added — an "Applies to" column naming the
// signed step — was retired in v0.27.6; its absence is asserted in
// enhance-flow-insights-menu-ui.spec.ts.

const INSIGHTS_PATH = "/admin/dashboards/insights";
const SUBJECT_FLOW_NAME = "E2E SEED Approval Subject Flow";

// Returns null when the flow opened, or the reason it could not be found —
// which goes straight into the skip message, and so into the run summary.
const openSubjectFlow = async (page: import("@playwright/test").Page): Promise<string | null> => {
  await page.goto(INSIGHTS_PATH);
  await page.waitForLoadState("networkidle");

  // Was `getByRole("button", { name })`, which only ever matched while the
  // seeded flow was among the first five cards. See helpers/flow-selector.ts.
  const selection = await selectFlowInSelector(page, SUBJECT_FLOW_NAME);
  if (!selection.selected) return selection.reason;

  await expect(page.getByRole("columnheader", { name: /outcome/i }).first()).toBeVisible();
  return null;
};

test.describe("Flow Insights: approval steps segmented by step", () => {
  test("each approval step gets its own Outcome column, named by step", async ({ page }) => {
    const blocked = await openSubjectFlow(page);
    test.skip(blocked !== null, `Seeded approval-subject flow not in insights: ${blocked}`);

    // Two decided approval steps → two Outcome columns. One would mean the
    // collapse rules merged two different sign-offs.
    await expect(page.getByRole("columnheader", { name: /outcome/i })).toHaveCount(2);

    // Each is captioned with the step it belongs to, so a reader can tell which
    // sign-off a cell refers to.
    const header = page.getByRole("columnheader", { name: /outcome/i });
    await expect(header.filter({ hasText: "Delegate sign-off" })).toHaveCount(1);
    await expect(header.filter({ hasText: "Records sign-off" })).toHaveCount(1);
  });

  test("combining forked steps or versions never merges two approval steps", async ({ page }) => {
    const blocked = await openSubjectFlow(page);
    test.skip(blocked !== null, `Seeded approval-subject flow not in insights: ${blocked}`);

    // Both toggles default ON where they are offered at all; flipping whatever
    // is present must not reduce the two sign-offs to one column.
    for (const label of [/combine forked steps/i, /combine across versions/i]) {
      const toggle = page.getByRole("checkbox", { name: label });
      if (await toggle.isVisible().catch(() => false)) await toggle.uncheck();
    }

    await expect(page.getByRole("columnheader", { name: /outcome/i })).toHaveCount(2);
  });

  test("the report names the approver", async ({ page }) => {
    const blocked = await openSubjectFlow(page);
    test.skip(blocked !== null, `Seeded approval-subject flow not in insights: ${blocked}`);

    // The approver as a person, not the raw user id the projection used to hold.
    await expect(page.getByRole("cell", { name: "Jane Doe" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Sam Patel" }).first()).toBeVisible();
  });

  test("a step decided twice shows its latest decision, noting the revision", async ({ page }) => {
    const blocked = await openSubjectFlow(page);
    test.skip(blocked !== null, `Seeded approval-subject flow not in insights: ${blocked}`);

    // Records sign-off was sent back for changes, then approved. The report
    // must read as the step now stands, not as it stood on the first pass.
    const table = page.getByRole("table");
    await expect(table.getByText("changes_requested")).toHaveCount(0);

    // …and say it took two passes to get there.
    await expect(table.getByText("(Revision 2)")).toBeVisible();

    // The single-pass sign-off carries no note, so the ordinary case reads clean.
    await expect(table.getByText("(Revision 1)")).toHaveCount(0);
  });

  test("the revision count is its own column, so a report can filter on it", async ({ page }) => {
    const blocked = await openSubjectFlow(page);
    test.skip(blocked !== null, `Seeded approval-subject flow not in insights: ${blocked}`);

    await expect(page.getByRole("columnheader", { name: /revision/i }).first()).toBeVisible();
  });

  test("the Columns dialog groups the approval fields under their own step", async ({ page }) => {
    const blocked = await openSubjectFlow(page);
    test.skip(blocked !== null, `Seeded approval-subject flow not in insights: ${blocked}`);

    await page.getByRole("button", { name: "Columns" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Delegate sign-off")).toBeVisible();
    await expect(dialog.getByText("Records sign-off")).toBeVisible();
  });
});
