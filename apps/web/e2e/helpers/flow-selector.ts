import { expect, type Page } from "@playwright/test";

/**
 * Selects a flow in the shared `FlowSelector` (Flow Insights, Flow Usage).
 *
 * The selector renders only the first five flows as cards
 * (`FLOW_CARD_THRESHOLD` in components/admin/flow-selector.tsx); everything
 * beyond that is reachable only through the "Search for more" box. Specs that
 * looked for their flow with `getByRole("button", { name })` therefore found
 * nothing as soon as the run had created a sixth flow, and skipped themselves
 * with "Seeded … flow not in insights" — reporting a seed gap for a flow the
 * seed had created correctly.
 *
 * How many flows exist varies by shard, because specs create them as they go.
 * That is why the same run can show both "flow not in insights" (too many
 * flows) and "requires > 5 flows" (too few) from different specs.
 */
export async function selectFlowInSelector(page: Page, flowName: string): Promise<boolean> {
  const card = page.getByRole("button", { name: flowName });
  if (await card.isVisible().catch(() => false)) {
    await card.click();
    return true;
  }

  const searchButton = page.getByRole("button", { name: /search for more/i });
  if (!(await searchButton.isVisible().catch(() => false))) return false;

  await searchButton.click();
  await page.getByPlaceholder(/search flows/i).fill(flowName);

  const option = page.getByTestId("flow-search-option").filter({ hasText: flowName }).first();
  if (!(await option.isVisible().catch(() => false))) return false;

  // The option commits on mousedown — it preempts the input's blur, which would
  // otherwise tear the list down before a click landed.
  await option.click();
  await expect(page.getByPlaceholder(/search flows/i)).toHaveCount(0);
  return true;
}
