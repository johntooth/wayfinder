/**
 * redline-grouping.spec.ts
 *
 * The redline grouping stage served inside the forked Wayfinder (ADR-0019,
 * delivery-plan item 1 step 2). A specialist opens /evaluations/:id/grouping and
 * lands on the grouping surface, which routes into the served review and pricing
 * screens.
 *
 * The interactive composition surface — drag documents into response groups,
 * mark consortiums, advance the stage over the WorkflowManager — is deferred to
 * the lens stage machine (delivery-plan §3), so it is deliberately NOT served yet
 * and NOT asserted here. The three relationship shapes and the stage advance stay
 * proven in the redline-web vitest suite (workflow-manager.test.ts); this spec
 * pins only what the fork actually serves today: the grouping landing and its
 * navigation into the read-side surfaces.
 *
 * Runs against the served fork with the shared admin session (auth is
 * delivery-plan item 1 step 1). Needs an evaluation id from the environment and
 * skips otherwise, matching the fork's other seed-gated phase specs.
 */

import { test, expect } from './helpers/base';

const EVALUATION_ID = process.env.E2E_REDLINE_EVALUATION_ID;

test.describe('redline grouping stage', () => {
  test.beforeEach(() => {
    test.skip(
      !EVALUATION_ID,
      'Needs a redline evaluation the CI seed does not create yet (waits on the live getContainer() wiring, delivery-plan item 2) — runs with E2E_REDLINE_EVALUATION_ID set.',
    );
  });

  test('lands on the grouping surface without JS errors', async ({ page, consoleLogs }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/grouping`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Grouping' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/redline-grouping.png', fullPage: true });

    const jsErrors = consoleLogs.filter((log) => log.type === 'error');
    expect(jsErrors, `JS errors on grouping:\n${jsErrors.map((error) => error.text).join('\n')}`).toHaveLength(0);
  });

  test('routes into the served review and pricing surfaces', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/grouping`);

    // The body copy links "review grid" / "pricing pivots" carry the exact
    // lower-case labels; the header nav uses "Review" / "Pricing pivots", so an
    // exact match keeps each selector to the single intended link.
    await page.getByRole('link', { name: 'review grid', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluations/${EVALUATION_ID}/review$`));

    await page.goBack();
    await page.getByRole('link', { name: 'pricing pivots', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluations/${EVALUATION_ID}/pivots$`));
  });
});
