import { expect, type Page } from "@playwright/test";

/**
 * Selects a flow in the shared `FlowSelector` (Flow Insights, Flow Usage).
 *
 * The selector renders only the first five flows as cards
 * (`FLOW_CARD_THRESHOLD` in components/admin/flow-selector.tsx); everything
 * beyond that is reachable only through the "Search for more" box, which specs
 * matching with `getByRole("button", { name })` never used.
 *
 * That threshold is real but it is *not* what makes the insights specs skip:
 * routing them through here left the count at exactly 9, unchanged across
 * runs. `GetFlowDeepDive` lists every non-deleted guided flow with no
 * filtering, so the seeded flow should be in the data whatever else exists.
 *
 * So this returns *why* it failed rather than a bare false, and the caller
 * puts that in the skip message — where the run summary groups it, instead of
 * an attachment that never leaves the runner because `test-results/` is
 * uploaded only on failure and a skip is not one.
 */
export type FlowSelectionResult = { selected: true } | { selected: false; reason: string };

export async function selectFlowInSelector(
  page: Page,
  flowName: string,
): Promise<FlowSelectionResult> {
  // This is what was actually wrong. `waitForLoadState('networkidle')` returns
  // while the page still shows "Loading…": the deep-dive tRPC query resolves
  // after it, and _content.tsx renders nothing but that word until it does. The
  // specs looked straight away, found no cards, and skipped — reporting a
  // missing flow for a query that simply had not come back.
  await page
    .getByText(/loading…/i)
    .first()
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => undefined);

  const card = page.getByRole("button", { name: flowName });
  if (await card.isVisible().catch(() => false)) {
    await card.click();
    return { selected: true };
  }

  const searchButton = page.getByRole("button", { name: /search for more/i });
  if (!(await searchButton.isVisible().catch(() => false))) {
    return { selected: false, reason: await describeSelectorState(page) };
  }

  await searchButton.click();
  await page.getByPlaceholder(/search flows/i).fill(flowName);

  const option = page.getByTestId("flow-search-option").filter({ hasText: flowName }).first();
  if (!(await option.isVisible().catch(() => false))) {
    return { selected: false, reason: "searched the overflow box; the flow was not among results" };
  }

  // The option commits on mousedown — it preempts the input's blur, which would
  // otherwise tear the list down before a click landed.
  await option.click();
  await expect(page.getByPlaceholder(/search flows/i)).toHaveCount(0);
  return { selected: true };
}

/**
 * Distinguishes the three ways the selector can show neither the flow nor an
 * overflow control, which are three different bugs:
 *
 *   still loading  — the deep-dive query had not resolved when the spec looked
 *   no flows yet   — the query resolved empty
 *   N cards, none matching — the flow is genuinely absent from GetFlowDeepDive
 */
async function describeSelectorState(page: Page): Promise<string> {
  if (await page.getByText(/loading…/i).first().isVisible().catch(() => false)) {
    return "the deep-dive query had not resolved yet";
  }
  if (await page.getByText(/no flows yet/i).first().isVisible().catch(() => false)) {
    return "the deep dive reported no flows at all";
  }

  const cards = await page.getByRole("button").allInnerTexts().catch(() => [] as string[]);
  const names = cards
    .map((text) => text.split("\n")[0]?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 8);
  return `${names.length} control(s) present, none matching: ${names.join(" | ")}`;
}
