import { expect, test, type Page } from "@playwright/test";

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
  if (!(await searchButton.isVisible().catch(() => false))) {
    // Neither the card nor the overflow control. Attach what the selector was
    // actually showing: with no cards at all the query had not resolved, and
    // with cards but no overflow the flow is genuinely absent from
    // GetFlowDeepDive — two different problems that look identical from here.
    await attachSelectorState(page, flowName, "no card and no overflow control");
    return false;
  }


  await searchButton.click();
  await page.getByPlaceholder(/search flows/i).fill(flowName);

  const option = page.getByTestId("flow-search-option").filter({ hasText: flowName }).first();
  if (!(await option.isVisible().catch(() => false))) {
    await attachSelectorState(page, flowName, "searched, but the flow was not among the results");
    return false;
  }

  // The option commits on mousedown — it preempts the input's blur, which would
  // otherwise tear the list down before a click landed.
  await option.click();
  await expect(page.getByPlaceholder(/search flows/i)).toHaveCount(0);
  return true;
}

/**
 * Records what the selector was showing when a flow could not be found.
 *
 * Three runs reported "Seeded approval-subject flow not in insights" exactly 9
 * times, which is too stable for a state race — but the flow is created by the
 * seed and `GetFlowDeepDive` lists every non-deleted guided flow, so it should
 * be there. The distinguishing evidence is whether any cards rendered at all.
 */
async function attachSelectorState(page: Page, flowName: string, reason: string): Promise<void> {
  const heading = await page
    .getByText(/loading…|no flows yet/i)
    .first()
    .textContent()
    .catch(() => null);
  const cardNames = await page
    .locator("button")
    .allInnerTexts()
    .catch(() => [] as string[]);

  await test
    .info()
    .attach("flow-selector-state.json", {
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({ lookingFor: flowName, reason, pageState: heading, cardNames }, null, 2),
      ),
    })
    .catch(() => undefined);
}
