/**
 * helpers/flow-builder.ts
 *
 * One way to create a flow and land on its canvas.
 *
 * Thirteen specs each carried their own near-identical copy of this — same
 * dialog, same selectors, differing only in the expert-role string and whether
 * the copy returned the new flow's id. Every copy also ended with
 * `waitForTimeout(1_200)`, a guess at how long ReactFlow takes to paint that is
 * simultaneously too long on CI and too short on a cold dev compile.
 *
 * Two behaviours differ from the copies this replaces:
 *
 *   - It throws rather than returning null. The callers all followed a null
 *     with `test.skip(!flowId, 'Could not create a flow / resolve its id')`,
 *     which turns "the product cannot create a flow" — about as load-bearing a
 *     failure as this app has — into a green run.
 *   - It waits for the canvas to actually paint its empty state instead of
 *     sleeping. A fresh flow has no nodes, so the first-step button is the
 *     signal that ReactFlow has mounted and the page is interactive.
 */

import { expect, type Page } from './base';

/** The empty-canvas call to action, rendered only once ReactFlow has mounted. */
export const FIRST_STEP_BUTTON = /\+ Create your first step in your workflow/i;

const FLOW_ID_IN_URL = /\/flows\/([0-9a-f-]{36})/;

export interface CreateFlowOptions {
  /** Shown in the flow's header and used as the AI's persona. */
  expertRole?: string;
}

/**
 * Create a flow through the admin dialog and wait until its canvas is ready to
 * drive. Returns the new flow's id.
 */
export async function createFlow(
  page: Page,
  name: string,
  options: CreateFlowOptions = {},
): Promise<string> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill(options.expertRole ?? 'E2E Test Expert');
  await page.getByRole('button', { name: /create flow/i }).click();

  // Creating a flow lands on the canvas editor directly (v0.21.0) — there is no
  // trip back to the list to click "Configure Flow". The canvas route is heavy
  // (ReactFlow) and on a cold dev server the first navigation also triggers
  // on-demand compilation, so allow the full navigation timeout.
  await page.waitForURL(/\/flows\/[^/]+\/config$/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: FIRST_STEP_BUTTON })).toBeVisible({
    timeout: 30_000,
  });

  const flowId = FLOW_ID_IN_URL.exec(page.url())?.[1];
  if (!flowId) {
    throw new Error(
      `Created the flow "${name}" but could not read its id from ${page.url()}. ` +
        `The canvas route shape changed, or creation silently failed.`,
    );
  }
  return flowId;
}

/**
 * Create a flow and open its canvas without needing the id — the same call for
 * specs that only drive the editor.
 */
export async function createFlowAndOpenCanvas(
  page: Page,
  name: string,
  options: CreateFlowOptions = {},
): Promise<void> {
  await createFlow(page, name, options);
}
