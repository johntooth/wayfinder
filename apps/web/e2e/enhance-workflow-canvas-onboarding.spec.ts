/**
 * enhance-workflow-canvas-onboarding.spec.ts
 *
 * Coverage for the canvas onboarding guidance (v0.21.2). The flow-config canvas
 * assumed the author already knew that steps run left to right and are joined by
 * dragging between the dots on their edges. Three additions teach it:
 *
 *   1. An empty canvas asks for "your first step in your workflow" rather than
 *      naming the mechanic ("+ Add step").
 *   2. With steps present, a faded prompt sits to the right of the right-most
 *      step offering the next one, and joins it to the flow's single open end.
 *   3. A step joined to nothing raises a yellow warning explaining that every
 *      step must be joined, with a looping diagram of the drag gesture.
 */

import { test, expect } from './helpers/base';
import type { Page } from '@playwright/test';

const FIRST_STEP_BUTTON = '+ Create your first step in your workflow';
const NEXT_STEP_BUTTON = '+ Create the next step in your workflow';

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Onboarding Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await page.waitForURL(/\/flows\/[^/]+\/config$/, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

// Resolves the node-type picker and the step config modal that follow every
// create action, leaving a saved step on the canvas.
async function configureStep(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 10_000 });
  await page.locator('#node-name').fill(name);
  await page.locator('#ai-instruction').fill(`Collect what is needed for ${name}.`);
  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
}

test.describe('canvas onboarding guidance', () => {
  test('an empty canvas asks for the first step, and no next-step prompt yet', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Onboarding Empty ${Date.now()}`);

    await expect(page.getByRole('button', { name: FIRST_STEP_BUTTON })).toBeVisible({
      timeout: 15_000,
    });
    // Nothing to continue from, so the canvas offers no "next step".
    await expect(page.getByRole('button', { name: NEXT_STEP_BUTTON })).toHaveCount(0);
    // And with no steps at all there is nothing to warn about.
    await expect(page.getByText(/aren't joined up yet/)).toHaveCount(0);

    await page.screenshot({
      path: 'screenshots/onboarding-empty-canvas.png',
      fullPage: true,
    });
  });

  test('the next-step prompt appears after the first step and joins what it creates', async ({
    page,
  }) => {
    await createFlowAndOpenCanvas(page, `Onboarding Next ${Date.now()}`);

    await page.getByRole('button', { name: FIRST_STEP_BUTTON }).click();
    await configureStep(page, 'Gather requirements');

    // The first-step overlay gives way to the faded next-step prompt.
    await expect(page.getByRole('button', { name: FIRST_STEP_BUTTON })).toHaveCount(0, {
      timeout: 10_000,
    });
    const nextStepButton = page.getByRole('button', { name: NEXT_STEP_BUTTON });
    await expect(nextStepButton).toBeVisible({ timeout: 10_000 });

    // A single step is an unambiguous parent, so the new step is joined to it
    // and the disconnected warning never fires.
    await nextStepButton.click();
    await configureStep(page, 'Draft the document');

    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByText(/aren't joined up yet/)).toHaveCount(0);

    await page.screenshot({
      path: 'screenshots/onboarding-next-step-joined.png',
      fullPage: true,
    });
  });

  test('a step joined to nothing raises the yellow warning with the drag diagram', async ({
    page,
  }) => {
    await createFlowAndOpenCanvas(page, `Onboarding Warning ${Date.now()}`);

    await page.getByRole('button', { name: FIRST_STEP_BUTTON }).click();
    await configureStep(page, 'Gather requirements');

    // The toolbar's "+ Add step" drops a step onto the canvas without joining
    // it to anything — exactly the state the warning exists to explain.
    await page.getByRole('button', { name: '+ Add step' }).first().click();
    await configureStep(page, 'Stranded step');

    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);

    const warning = page.getByText(/Some steps aren't joined up yet/);
    await expect(warning).toBeVisible({ timeout: 10_000 });
    await expect(warning).toContainText('Every step needs to be joined to the others');
    // The demonstration sits under the copy and is decorative, so it is present
    // in the DOM but hidden from assistive technology.
    await expect(page.locator('svg.wf-connect-demo')).toBeAttached();
    await expect(page.locator('svg.wf-connect-demo')).toHaveAttribute('aria-hidden', 'true');

    await page.screenshot({
      path: 'screenshots/onboarding-disconnected-warning.png',
      fullPage: true,
    });

    // Joining the two steps clears the warning without a reload.
    const handles = page.locator('.react-flow__handle-right');
    const target = page.locator('.react-flow__handle-left').last();
    await handles.first().hover();
    await page.mouse.down();
    await target.hover();
    await page.mouse.up();

    await expect(page.locator('.react-flow__edge')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByText(/aren't joined up yet/)).toHaveCount(0, { timeout: 10_000 });
  });
});
