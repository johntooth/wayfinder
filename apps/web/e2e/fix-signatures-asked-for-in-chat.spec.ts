/**
 * fix-signatures-asked-for-in-chat.spec.ts
 *
 * E2E for the conversation demanding signature values, and for the two authoring
 * affordances that stop a signature being left unsigned.
 * (docs/development/implemented/alpha-2/v0.27.0/fix-signatures-asked-for-in-chat.md)
 *
 * Driven by CI (.github/workflows/e2e.yml) against a full stack — excluded from
 * the vitest unit run.
 *
 * The reported symptom: after a cross-check, the chat listed "Supervisor
 * signature is blank" as something still needed and then asked the operator to
 * name the approving supervisors. Only the approval step that owns the slot may
 * ever write it (ADR-043 §2), so the operator can only answer wrongly.
 */

import { test, expect } from './helpers/base';
import type { Page } from '@playwright/test';
import { loadSeedFixtures } from './helpers/seed';

const seed = loadSeedFixtures();

async function openApprovalConfig(page: Page, flowId: string, stepName: string): Promise<void> {
  await page.goto(`/flows/${flowId}/config`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
  await page.locator('.react-flow__node', { hasText: stepName }).first().dblclick();
  await expect(page.locator('#approval-subject')).toBeVisible({ timeout: 10_000 });
}

test.describe('a signature is never asked for in the conversation', () => {
  test('the step gathers its fields without naming the signature slots', async ({ page }) => {
    const sessionId = seed?.approvalSubjectSessionId;
    test.skip(!sessionId, 'No seeded approval session — run the seed setup project');

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');

    // The seeded subject template declares delegate and finance signatures. The
    // readiness gate used to extract and grade the raw field set, so both were
    // reported as missing information and streamed into the thread.
    await expect(page.locator('[data-approval-gate]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/signature is blank/i)).toHaveCount(0);
    await expect(page.getByText(/who is the (first|second) supervisor/i)).toHaveCount(0);
  });
});

test.describe('the canvas warns about a signature nobody signs', () => {
  test('names the unsigned slot and how to bind it', async ({ page }) => {
    const flowId = seed?.approvalSubjectFlowId;
    test.skip(!flowId, 'No seeded approval flow — run the seed setup project');

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_200);

    // The seeded flow binds every slot, so the warning must stay silent — a
    // warning that fires on a correct flow is worse than none.
    await expect(page.locator('[data-unclaimed-signatures="0"]')).toBeVisible();
  });

  test('the warning band stacks advisories rather than overlapping them', async ({ page }) => {
    const flowId = seed?.approvalSubjectFlowId;
    test.skip(!flowId, 'No seeded approval flow — run the seed setup project');

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_200);

    // Both advisories live in one column, so a flow with two problems shows two
    // banners instead of one covering the other.
    const band = page.locator('[data-unclaimed-signatures]');
    await expect(band).toHaveCount(1);
  });
});

test.describe('the default subject offers its signature slots', () => {
  test('shows the slot dropdown without the author naming a step', async ({ page }) => {
    const flowId = seed?.approvalSubjectFlowId;
    test.skip(!flowId, 'No seeded approval flow — run the seed setup project');

    await openApprovalConfig(page, flowId, 'Delegate sign-off');

    // Move the subject back to the default. Before this change that emptied the
    // slot list, so the signature became untargetable and would never be signed.
    await page.locator('#approval-subject').selectOption('');

    const slot = page.locator('[data-approval-signature-slot]');
    await expect(slot).toBeVisible();
    await expect(slot.locator('option')).not.toHaveCount(1);
    await expect(page.getByText(/the step this default will reach/i)).toBeVisible();
  });
});
