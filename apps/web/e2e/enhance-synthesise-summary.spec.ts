/**
 * enhance-synthesise-summary.spec.ts
 *
 * Enhancement: Summary of outputs enhancements (v2.16.2).
 *
 * Covers the reworked run screen — the header bar, one-click Excel download, the
 * overflow menu holding JSON and document generation, the flat one-row-per-record
 * table with its RAG indicators, and the expandable detail row carrying the source
 * files that used to live in a left sidebar. Skip-guarded like the other
 * extraction specs so it is inert without an authenticated, flag-enabled session.
 */

import { test, expect } from './helpers/base';

const atLogin = (url: string): boolean => url.includes('/login');

// Reaching a run screen means authoring a synthesis and running a sample; a run
// without staged input documents never leaves the editor. Both specs need the
// same preamble, so it lives here.
const openRunScreen = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await page.goto('/synthesise');
  if (atLogin(page.url())) {
    test.skip(true, 'No authenticated session available');
    return false;
  }

  const listHeading = page.getByRole('heading', { name: /^Synthesise Information$/ });
  const disabledState = page.getByText(/not (available|enabled)/i).first();
  await expect(listHeading.or(disabledState).first()).toBeVisible();
  if (await disabledState.isVisible().catch(() => false)) {
    test.skip(true, 'extraction_flows flag not enabled for this user');
    return false;
  }

  await page.getByRole('button', { name: /New synthesis/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('E2E summary screen synthesis');
  await dialog.getByRole('button', { name: /^Create$/ }).click();
  // The E2E server runs `next dev`, so routes compile on first hit.
  await page.waitForURL(/\/synthesise\/[^/]+\/edit/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /Edit synthesis/i })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: /Configure output/i }).click();
  await expect(page.getByRole('button', { name: /Run sample/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Run sample/i }).click();

  const summaryHeading = page.getByRole('heading', { name: /Summary of outputs/i });
  const needDocsToast = page.getByText(/Upload .*document/i).first();
  await expect(summaryHeading.or(needDocsToast).first()).toBeVisible({ timeout: 30_000 });

  if (!(await summaryHeading.isVisible().catch(() => false))) {
    test.skip(true, 'Sample run needs staged input documents to reach the run screen');
    return false;
  }
  return true;
};

test.describe('Synthesise Information — summary of outputs', () => {
  test('header offers a one-click Excel download and an overflow menu for JSON and documents', async ({
    page,
  }) => {
    if (!(await openRunScreen(page))) return;

    // The screen now has the standard header bar: back affordance + title, and
    // the run's actions on the right rather than in a button row in the body.
    await expect(page.getByRole('link', { name: /Back to edit the flow/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Summary of outputs/i })).toBeVisible();

    // Download Excel is a single action — no reveal-then-click intermediate step.
    const downloadExcel = page.getByRole('button', { name: /^Download Excel$/ });
    await expect(downloadExcel).toBeVisible();
    await expect(page.getByRole('button', { name: /^Download data$/ })).toHaveCount(0);

    const download = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      downloadExcel.click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

    // JSON and document generation moved into the overflow menu.
    await page.getByRole('button', { name: /Run actions/i }).click();
    await expect(page.getByRole('button', { name: /^Download JSON$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Generate documents$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^All runs$/ })).toBeVisible();

    // Escape closes it, like the editor's menu.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Download JSON$/ })).toBeHidden();
  });

  test('results are one row per record, expanding to reveal source files', async ({ page }) => {
    if (!(await openRunScreen(page))) return;

    const table = page.getByTestId('results-table');
    await expect(table).toBeVisible({ timeout: 30_000 });

    // The left "Included files" sidebar is gone — provenance lives in the row.
    await expect(page.getByText('Included files')).toHaveCount(0);

    const rows = page.getByTestId('result-row');
    const rowCount = await rows.count();
    if (rowCount === 0) {
      test.skip(true, 'Sample run produced no records to review');
      return;
    }

    // Each value carries a RAG indicator that opens the rationale behind it.
    const firstRow = rows.first();
    const confidenceDot = firstRow.getByRole('button', { name: /confidence.*Show rationale/i }).first();
    if (await confidenceDot.isVisible().catch(() => false)) {
      await confidenceDot.click();
      const rationaleDialog = page.getByRole('dialog').filter({ hasText: /Confidence rationale/i });
      await expect(rationaleDialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(rationaleDialog).toBeHidden();
    }

    // Expanding a row reveals its detail: source files and the paired field grid.
    const expandToggle = page.getByTestId('expand-record').first();
    await expect(expandToggle).toHaveAttribute('aria-expanded', 'false');
    await expandToggle.click();
    await expect(expandToggle).toHaveAttribute('aria-expanded', 'true');

    const detail = page.getByTestId('result-row-detail').first();
    await expect(detail).toBeVisible();
    await expect(detail.getByText('Source files')).toBeVisible();
    await expect(detail.getByText('Extracted fields')).toBeVisible();

    // And collapses again.
    await expandToggle.click();
    await expect(page.getByTestId('result-row-detail')).toHaveCount(0);
  });
});
