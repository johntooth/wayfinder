/**
 * fix-canvas-single-step-zoom.spec.ts
 *
 * Coverage for the single-step canvas zoom fix (v0.21.3). React Flow's
 * fit-to-view defaults its ceiling to the pane's maxZoom of 2, so a canvas
 * holding one step opened it at twice the scale everything else is drawn at —
 * the step filled the pane and read as far closer than the empty canvas the
 * author had just been looking at. Fit-to-view is now capped at 1x.
 */

import { test, expect } from './helpers/base';
import type { Page } from '@playwright/test';

const FIRST_STEP_BUTTON = '+ Create your first step in your workflow';

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Canvas Zoom Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await page.waitForURL(/\/flows\/[^/]+\/config$/, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

async function configureStep(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 10_000 });
  await page.locator('#node-name').fill(name);
  await page.locator('#ai-instruction').fill(`Collect what is needed for ${name}.`);
  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
}

// React Flow writes the live zoom into the viewport's transform as
// "translate(x, y) scale(z)".
async function readCanvasZoom(page: Page): Promise<number> {
  const transform = await page
    .locator('.react-flow__viewport')
    .first()
    .evaluate((element) => getComputedStyle(element).transform);
  // getComputedStyle resolves the transform to a matrix; its first entry is the
  // horizontal scale, which React Flow keeps equal to the zoom level.
  const values = transform.replace(/^matrix\(|\)$/g, '').split(',').map(Number);
  return values[0] ?? Number.NaN;
}

test.describe('canvas zoom with a single step', () => {
  test('opening a one-step flow fits to view without magnifying past 1x', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Canvas Zoom ${Date.now()}`);

    await page.getByRole('button', { name: FIRST_STEP_BUTTON }).click();
    await configureStep(page, 'Gather requirements');
    await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15_000 });

    // Re-open the canvas so React Flow's initial fit-to-view runs against the
    // saved single-step flow, which is the state the author lands in.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 15_000 });
    await page.waitForTimeout(1_000);

    const zoom = await readCanvasZoom(page);
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThanOrEqual(1.01);

    await page.screenshot({
      path: 'screenshots/canvas-single-step-zoom.png',
      fullPage: true,
    });
  });
});
