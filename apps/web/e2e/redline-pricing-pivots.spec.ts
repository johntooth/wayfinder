/**
 * redline-pricing-pivots.spec.ts
 *
 * The redline pricing pivots served inside the forked Wayfinder (ADR-0019,
 * delivery-plan item 1 step 2). A specialist opens /evaluations/:id/pivots and
 * rolls a tender's costed responses up per vendor, per requirement, and as a
 * vendor × requirement cross-tab, toggling between sum and average.
 *
 * Runs against the served fork with the shared admin session. The pivots only
 * carry numeric data once the live getContainer() is wired (delivery-plan item
 * 2), which the CI seed does not create yet — so it needs an evaluation id from
 * the environment and skips otherwise, matching the fork's other seed-gated phase
 * specs. The roll-up and currency shaping stay proven in the redline-web vitest
 * suite (pricing-pivot.test.ts / pricing-view.test.ts); this spec pins the served
 * DOM the shaping binds to.
 */

import { test, expect } from './helpers/base';

const EVALUATION_ID = process.env.E2E_REDLINE_EVALUATION_ID;

test.describe('redline pricing pivots', () => {
  test.beforeEach(() => {
    test.skip(
      !EVALUATION_ID,
      'Needs a redline evaluation the CI seed does not create yet (waits on the live getContainer() wiring, delivery-plan item 2) — runs with E2E_REDLINE_EVALUATION_ID set.',
    );
  });

  test('rolls pricing up per vendor (brand)', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/pivots`);

    await page.getByLabel('Pivot axis').selectOption('brand');
    const pivot = page.getByTestId('pivot-table');
    await expect(pivot).toBeVisible();
    await expect(pivot.getByRole('columnheader', { name: 'Vendor' })).toBeVisible();
    await expect(pivot.getByRole('columnheader', { name: 'Total (AUD)' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/redline-pivots-brand.png', fullPage: true });
  });

  test('rolls pricing up per requirement/criterion', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/pivots`);

    await page.getByLabel('Pivot axis').selectOption('requirement');
    await expect(
      page.getByTestId('pivot-table').getByRole('columnheader', { name: 'Requirement' }),
    ).toBeVisible();
  });

  test('cross-tabulates vendor × requirement', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/pivots`);

    await page.getByLabel('Pivot axis').selectOption('brand-x-requirement');
    const headers = await page.getByTestId('pivot-table').getByRole('columnheader').allInnerTexts();
    // Vendor + one column per requirement + a row-total column.
    expect(headers.length).toBeGreaterThan(2);
  });

  test('toggles between sum and average', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/pivots`);

    await page.getByLabel('Pivot measure').selectOption('avg');
    await expect(
      page.getByTestId('pivot-table').getByRole('columnheader', { name: 'Average (AUD)' }),
    ).toBeVisible();
  });
});
