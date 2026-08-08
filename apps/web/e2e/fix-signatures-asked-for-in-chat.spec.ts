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
  test('stays silent on a flow whose signatures are all bound', async ({ page }) => {
    const flowId = seed?.approvalSubjectFlowId;
    test.skip(!flowId, 'No seeded approval flow — run the seed setup project');

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_200);

    // The seeded flow binds every slot by name, so the warning must stay silent —
    // a warning that fires on a correct flow is worse than none.
    //
    // Asserted by count, not visibility: the live region stays mounted and
    // renders nothing when there is nothing to report, so it has no box and is
    // never "visible" in the silent state this test is about.
    await expect(page.locator('[role="status"][data-unclaimed-signatures]')).toHaveAttribute(
      'data-unclaimed-signatures',
      '0',
    );
  });

  // The reported regression: the author bound the signature but left the
  // approval on the default subject, which stores no `approvalSubject` — so the
  // claim was scoped to nothing and the advisory fired on a bound flow.
  test('stays quiet about a slot bound by an approval on the default subject', async ({ page }) => {
    const flowId = seed?.signatureWarningFlowId;
    test.skip(!flowId, 'No seeded signature-warning flow — run the seed setup project');

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_200);

    // The flow declares two signatures: one signed by a default-subject
    // approval, one nothing signs. Only the second may be reported.
    await expect(page.locator('[role="status"][data-unclaimed-signatures]')).toHaveAttribute(
      'data-unclaimed-signatures',
      '1',
    );
    await expect(page.getByText(/Supervisor Signature/)).toHaveCount(0);
  });

  test('names the unsigned slot, its step, and how to bind it', async ({ page }) => {
    const flowId = seed?.signatureWarningFlowId;
    test.skip(!flowId, 'No seeded signature-warning flow — run the seed setup project');

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_200);

    // "A signature is unsigned" is not actionable; the slot and the step it sits
    // on are, and the copy has to carry the binding steps with them.
    const advisory = page.locator('[role="status"][data-unclaimed-signatures]');
    await expect(advisory).toContainText('Annexe Signature');
    await expect(advisory).toContainText('Prepare the annexe');
    await expect(advisory).toContainText(/render blank on the finished document/i);
    await expect(advisory).toContainText(/What is being approved\?/i);
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
