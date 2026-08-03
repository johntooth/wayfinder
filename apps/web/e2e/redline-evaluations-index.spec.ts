/**
 * redline-evaluations-index.spec.ts
 *
 * The way in to redline (ADR-0019, redline delivery-plan item 2). Before this
 * there was no /evaluations index and nothing in Wayfinder's chrome linking to
 * redline at all, so a tester needed both the URL shape and an evaluation id
 * handed to them out of band.
 *
 * This is the item's exit test: a specialist who has never seen the URL signs
 * in, finds the Evaluations entry in the sidebar, and opens a review grid from
 * it. Runs against the served fork with the shared admin session (auth is
 * delivery-plan item 1 step 1), who holds evaluation:review via the admin
 * wildcard.
 *
 * The index itself needs no seeded evaluation — it renders its empty state — so
 * the first two tests always run. Only the last one, which follows a row through
 * to a review grid, needs a real evaluation and skips without
 * E2E_REDLINE_EVALUATION_ID, matching the fork's other seed-gated specs.
 *
 * The negative half of the exit ("a user without evaluation:review sees neither
 * the entry nor the route") is proven where it can be: the unauthenticated case
 * here, the route's server gate in src/app/(user)/evaluations/page.test.tsx, and
 * the procedure's gate in src/server/routers/evaluation.test.ts. The suite has
 * no signed-in non-admin fixture to drive the permitted-user-minus-one-key case
 * through a browser.
 */

import { test, expect } from './helpers/base';

const EVALUATION_ID = process.env.E2E_REDLINE_EVALUATION_ID;

test.describe('redline evaluations index', () => {
  test('reaches the index from the sidebar without knowing the URL', async ({
    page,
    consoleLogs,
  }) => {
    await page.goto('/chats');

    await page.getByRole('link', { name: 'Evaluations' }).click();

    await expect(page).toHaveURL(/\/evaluations$/);
    await expect(page.getByRole('heading', { name: 'Evaluations' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/redline-evaluations-index.png', fullPage: true });

    const jsErrors = consoleLogs.filter((log) => log.type === 'error');
    expect(
      jsErrors,
      `JS errors on the evaluations index:\n${jsErrors.map((error) => error.text).join('\n')}`,
    ).toHaveLength(0);
  });

  test('does not serve the index to a caller with no session', async ({ browser }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await anonymous.newPage();

    await page.goto('/evaluations');

    await expect(page).not.toHaveURL(/\/evaluations$/);
    await expect(page.getByRole('heading', { name: 'Evaluations' })).toBeHidden();
    await anonymous.close();
  });

  test('opens a review grid from a row on the index', async ({ page }) => {
    test.skip(
      !EVALUATION_ID,
      'Needs a redline evaluation the CI seed does not create yet — runs with E2E_REDLINE_EVALUATION_ID set.',
    );

    await page.goto('/evaluations');

    const row = page.getByTestId('evaluation-link').filter({ hasText: EVALUATION_ID as string });
    await expect(row).toBeVisible();
    await row.click();

    await expect(page).toHaveURL(new RegExp(`/evaluations/${EVALUATION_ID}/(review|grouping)$`));
  });
});
