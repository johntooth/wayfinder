/**
 * redline-review-grid.spec.ts
 *
 * The redline review grid served inside the forked Wayfinder (ADR-0019,
 * delivery-plan item 1 step 2). A specialist opens /evaluations/:id/review and
 * sees every response delineated by topic and brand, currency sorts numerically
 * (not lexically), the source column deep-links to the document location, and the
 * requirement filter narrows the grid.
 *
 * Runs against the served fork with the shared admin session (auth is
 * delivery-plan item 1 step 1: the evaluation:review permission gate). The grid
 * only carries real rows once the live getContainer() is wired (delivery-plan
 * item 2), which the CI seed does not create yet — so it needs an evaluation id
 * from the environment and skips otherwise, matching the fork's other
 * seed-gated phase specs. The pure sort/filter/link shaping stays proven in the
 * redline-web vitest suite (review-grid.test.ts / review-view.test.ts); this
 * spec pins the served DOM the shaping binds to.
 */

import { test, expect } from './helpers/base';

const EVALUATION_ID = process.env.E2E_REDLINE_EVALUATION_ID;

test.describe('redline review grid', () => {
  test.beforeEach(() => {
    test.skip(
      !EVALUATION_ID,
      'Needs a redline evaluation the CI seed does not create yet (waits on the live getContainer() wiring, delivery-plan item 2) — runs with E2E_REDLINE_EVALUATION_ID set.',
    );
  });

  test('renders every required column for a real evaluation', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/review`);

    const grid = page.getByTestId('review-table');
    await expect(grid).toBeVisible();
    for (const label of [
      'Vendor',
      'Product',
      'Requirement',
      'Confidence',
      'Summary',
      'Estimate (AUD)',
      'Costing',
      'Source',
    ]) {
      await expect(grid.getByRole('columnheader', { name: label })).toBeVisible();
    }
    await page.screenshot({ path: 'screenshots/redline-review-grid-columns.png', fullPage: true });
  });

  test('sorts currency numerically, not lexically', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/review`);

    // A lexical sort of e.g. $90, $100, $1,000 would order 100 < 1000 < 90.
    await page.getByRole('button', { name: 'Sort by Estimate (AUD)' }).click();

    const rows = page.getByTestId('review-row');
    await expect(rows.first()).toBeVisible();
    const estimateColumn = await columnIndexFor(page, 'Estimate (AUD)');
    const amounts = await cellTexts(rows, estimateColumn);
    const numeric = amounts
      .map((text) => Number(text.replace(/[^0-9.]/g, '')))
      .filter((value) => Number.isFinite(value));
    const ascending = [...numeric].sort((a, b) => a - b);
    expect(numeric).toEqual(ascending);
  });

  test('the source column deep-links to the document location', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/review`);

    const link = page.getByTestId('review-source-link').first();
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`/evaluations/${EVALUATION_ID}/documents/.+element=`),
    );
  });

  test('filters the grid to a single requirement', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/review`);

    const options = await page.getByLabel('Filter by requirement').locator('option').all();
    const values = (await Promise.all(options.map((option) => option.getAttribute('value')))).filter(
      (value): value is string => Boolean(value),
    );
    expect(values.length, 'the served grid exposes at least one requirement to filter by').toBeGreaterThan(0);
    const requirementId = values[0];

    await page.getByLabel('Filter by requirement').selectOption(requirementId);

    const rows = page.getByTestId('review-row');
    const requirementColumn = await columnIndexFor(page, 'Requirement');
    const shown = await cellTexts(rows, requirementColumn);
    expect(new Set(shown)).toEqual(new Set([requirementId]));
  });
});

// The served review-table has no per-cell test ids, so read a column by its
// header position — resilient to column reordering, unlike a fixed index.
async function columnIndexFor(page: import('@playwright/test').Page, label: string): Promise<number> {
  const headers = await page.getByTestId('review-table').getByRole('columnheader').allInnerTexts();
  const index = headers.findIndex((header) => header.trim().startsWith(label));
  expect(index, `header "${label}" is present`).toBeGreaterThanOrEqual(0);
  return index;
}

async function cellTexts(
  rows: import('@playwright/test').Locator,
  columnIndex: number,
): Promise<string[]> {
  const count = await rows.count();
  const texts: string[] = [];
  for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
    texts.push((await rows.nth(rowIndex).locator('td').nth(columnIndex).innerText()).trim());
  }
  return texts;
}
