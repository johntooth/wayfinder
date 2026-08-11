import { test, expect } from "./helpers/base";
import { selectFlowInSelector } from "./helpers/flow-selector";

// E2E for the v0.27.6 enhancement
// (docs/development/implemented/alpha-2/v0.27.6/enhance-flow-insights-menu-ui.phase.md).
//
// Two independent changes:
//
//   1. Flow Insights no longer carries an "Applies to" column for approval
//      steps. The seeded approval flow's step-output rows still hold the
//      `applies_to` value they were written with, so this exercises the
//      read-side skip — not merely the stopped write.
//   2. The sidebar's brand row and its footer (admin-mode button, account chip)
//      stay put while the nav items scroll between them.

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

test.describe("Flow Insights: the approval subject is no longer a report column", () => {
  test("no Applies to column, even for an approval decided before it was retired", async ({
    page,
  }) => {
    const blocked = await openSubjectFlow(page);
    test.skip(blocked !== null, `Seeded approval-subject flow not in insights: ${blocked}`);

    await expect(page.getByRole("columnheader", { name: /applies to/i })).toHaveCount(0);

    // The seeded row's stored value went with the column, rather than hanging
    // on under a different heading.
    await expect(
      page.getByRole("cell", { name: /the output of the step "Prepare instrument"/i }),
    ).toHaveCount(0);
  });

  test("the rest of the approval metadata is untouched", async ({ page }) => {
    const blocked = await openSubjectFlow(page);
    test.skip(blocked !== null, `Seeded approval-subject flow not in insights: ${blocked}`);

    // Only one column was retired. If the skip were reaching too far, these are
    // what it would take with it.
    for (const heading of [/outcome/i, /revision/i, /decided by/i, /approver email/i]) {
      await expect(page.getByRole("columnheader", { name: heading }).first()).toBeVisible();
    }
    await expect(page.getByRole("cell", { name: "Jane Doe" }).first()).toBeVisible();
  });

  test("the Columns dialog does not offer it either", async ({ page }) => {
    const blocked = await openSubjectFlow(page);
    test.skip(blocked !== null, `Seeded approval-subject flow not in insights: ${blocked}`);

    await page.getByRole("button", { name: "Columns" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Outcome").first()).toBeVisible();
    await expect(dialog.getByText(/applies to/i)).toHaveCount(0);
  });
});

// Short enough that the admin rail's ~20 items cannot fit, which is the
// condition the change exists for.
test.describe("Sidebar: brand and footer stay put while the menu scrolls", () => {
  test.use({ viewport: { width: 1280, height: 420 } });

  const expandEveryGroup = async (page: import("@playwright/test").Page): Promise<void> => {
    // Group headers are buttons carrying a chevron; exact names because
    // "Advanced" is a prefix of "Advanced Flow Settings".
    const sidebar = page.getByTestId("app-sidebar");
    for (const label of ["Users and Roles", "Advanced Flow Settings", "Advanced"]) {
      const header = sidebar.getByRole("button", { name: label, exact: true });
      if (await header.isVisible().catch(() => false)) await header.click();
    }
  };

  test("the account chip and admin-mode button remain on screen", async ({ page }) => {
    await page.goto("/admin/flows");
    await expandEveryGroup(page);

    const scrollRegion = page.getByTestId("app-sidebar-scroll");
    const overflows = await scrollRegion.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    );
    test.skip(!overflows, "Admin rail fits this viewport — nothing to scroll");

    const accountChip = page.getByRole("button", { name: /account menu/i });
    const exitAdmin = page.getByRole("button", { name: /exit admin mode/i });
    await expect(accountChip).toBeInViewport();
    await expect(exitAdmin).toBeInViewport();

    // Still reachable, not merely painted on screen.
    await accountChip.click();
    await expect(page.getByRole("menu")).toBeVisible();
  });

  test("scrolling the nav moves the items and nothing else", async ({ page }) => {
    await page.goto("/admin/flows");
    await expandEveryGroup(page);

    const scrollRegion = page.getByTestId("app-sidebar-scroll");
    const overflows = await scrollRegion.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    );
    test.skip(!overflows, "Admin rail fits this viewport — nothing to scroll");

    const brand = page.getByTestId("app-sidebar").getByRole("link", { name: /wayfinder home/i });
    const accountChip = page.getByRole("button", { name: /account menu/i });
    const brandBefore = await brand.boundingBox();
    const chipBefore = await accountChip.boundingBox();

    await scrollRegion.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(async () => scrollRegion.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    // The two pinned regions held their position while the middle moved.
    expect((await brand.boundingBox())?.y).toBeCloseTo(brandBefore?.y ?? -1, 0);
    expect((await accountChip.boundingBox())?.y).toBeCloseTo(chipBefore?.y ?? -1, 0);

    // And the rail itself never became the scroller — that is the layout the
    // change replaced, and the one that carried the footer off the screen.
    const railScrolls = await page
      .getByTestId("app-sidebar")
      .evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(railScrolls).toBe(false);
  });

  test("a user's Recent chats scroll with the nav rather than beside it", async ({ page }) => {
    await page.goto("/chats");

    const sidebar = page.getByTestId("app-sidebar");
    const recentHeading = sidebar.getByText("Recent", { exact: true });
    test.skip(
      !(await recentHeading.isVisible().catch(() => false)),
      "No seeded chats — the Recent block is not rendered",
    );

    // The block lives inside the scroll region, so the footer below it stays
    // put no matter how many chats the account has.
    await expect(page.getByTestId("app-sidebar-scroll").getByText("Recent")).toBeVisible();
    await expect(page.getByRole("button", { name: /account menu/i })).toBeInViewport();

    // Capped, so the region has a bounded length to scroll through. Asserted as
    // a ceiling rather than an exact count — how many chats the seed leaves
    // behind is not this spec's business, only that the rail respects the cap.
    const recentLinks = await sidebar.locator('a[href^="/chats/"]').count();
    expect(recentLinks).toBeGreaterThan(0);
    expect(recentLinks).toBeLessThanOrEqual(8);
  });
});
