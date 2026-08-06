import { test, expect } from "./helpers/base";

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
//   3. The report says which step each approval applies to.

const INSIGHTS_PATH = "/admin/dashboards/insights";
const SUBJECT_FLOW_NAME = "E2E SEED Approval Subject Flow";

const openSubjectFlow = async (page: import("@playwright/test").Page): Promise<boolean> => {
  await page.goto(INSIGHTS_PATH);
  await page.waitForLoadState("networkidle");

  const selector = page.getByRole("button", { name: SUBJECT_FLOW_NAME });
  if (!(await selector.isVisible().catch(() => false))) return false;

  await selector.click();
  await expect(page.getByRole("columnheader", { name: /outcome/i }).first()).toBeVisible();
  return true;
};

test.describe("Flow Insights: approval steps segmented by step", () => {
  test("each approval step gets its own Outcome column, named by step", async ({ page }) => {
    test.skip(!(await openSubjectFlow(page)), "Seeded approval-subject flow not in insights");

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
    test.skip(!(await openSubjectFlow(page)), "Seeded approval-subject flow not in insights");

    // Both toggles default ON where they are offered at all; flipping whatever
    // is present must not reduce the two sign-offs to one column.
    for (const label of [/combine forked steps/i, /combine across versions/i]) {
      const toggle = page.getByRole("checkbox", { name: label });
      if (await toggle.isVisible().catch(() => false)) await toggle.uncheck();
    }

    await expect(page.getByRole("columnheader", { name: /outcome/i })).toHaveCount(2);
  });

  test("the report names the approver and what the approval applies to", async ({ page }) => {
    test.skip(!(await openSubjectFlow(page)), "Seeded approval-subject flow not in insights");

    // The approver as a person, not the raw user id the projection used to hold.
    await expect(page.getByRole("cell", { name: "Jane Doe" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Sam Patel" }).first()).toBeVisible();

    // And which step each sign-off was about.
    await expect(page.getByRole("columnheader", { name: /applies to/i }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /Prepare instrument/i }).first()).toBeVisible();
  });

  test("the Columns dialog groups the approval fields under their own step", async ({ page }) => {
    test.skip(!(await openSubjectFlow(page)), "Seeded approval-subject flow not in insights");

    await page.getByRole("button", { name: "Columns" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Delegate sign-off")).toBeVisible();
    await expect(dialog.getByText("Records sign-off")).toBeVisible();
  });
});
