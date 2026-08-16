/**
 * fix-signature-tag-lost-in-annotator.spec.ts
 *
 * E2E for the signature tag being destroyed by the guided annotation editor, and
 * for a lone signature slot never being bound in the approval config.
 * (docs/development/implemented/alpha-2/v0.26.2/fix-signature-tag-lost-in-annotator.md)
 *
 * Driven by CI (.github/workflows/e2e.yml) against a full stack — excluded from
 * the vitest unit run.
 *
 * The reported symptoms, asserted directly:
 *   1. `{{ Delegate Sign Off (approval) }}` is listed as a Signature, not as Text.
 *   2. Signature is offered in the type dropdown, and the row already sits on it.
 *   3. Editing the row re-emits `(approval)` — before this fix it wrote
 *      `(optional)` back into the author's stored .docx, deleting the slot.
 *   4. `(approval)` appears in the complete annotation reference, which is the
 *      only place an author could have learnt the tag exists.
 *   5. A subject step declaring a single signature shows the slot dropdown in
 *      the approval config. It previously showed nothing and left the config
 *      key empty, so the document was never signed.
 */

import { test, expect } from './helpers/base';
import type { Page, Route } from '@playwright/test';
import { requireSeedFixtures } from './helpers/seed';
import { createFlowAndOpenCanvas } from './helpers/flow-builder';

const fakeDocx = () => Buffer.from('PK\x03\x04 fake docx content');

const SIGNATURE_ROW = {
  key: 'delegate_sign_off',
  line: 'Delegate Sign Off (approval)',
  occurrences: [{ sourceText: '{{ Delegate Sign Off (approval) }}', occurrence: 0 }],
  locked: false,
};


async function addDocumentStep(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ Create your first step in your workflow' }).click();
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
  await page.locator('#node-name').fill('Draft the instrument');
  await page.locator('#ai-instruction').fill('Gather the instrument details.');
  await page.locator('label', { hasText: 'Generate document' }).click();
  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  await page.locator('.react-flow__node').first().dblclick();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
}

async function mockAnalyse(page: Page, rows: unknown[]): Promise<void> {
  await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template\/analyse$/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        filename: 'instrument.docx',
        format: 'docx',
        classification: 'annotated',
        documentText: 'Signed: {{ Delegate Sign Off (approval) }}',
        rows,
      }),
    });
  });
}

async function uploadTemplate(page: Page): Promise<void> {
  await page.locator('input[type="file"][accept=".docx,.xlsx"]').setInputFiles({
    name: 'instrument.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: fakeDocx(),
  });
}

test.describe('fix: the signature tag survives the annotation editor', () => {
  test('lists an (approval) tag as a Signature rather than as Text', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Signature Annotation ${Date.now()}`, { expertRole: 'E2E Signature Expert' });
    await addDocumentStep(page);
    await mockAnalyse(page, [SIGNATURE_ROW]);

    await uploadTemplate(page);

    await expect(page.getByText('1 data field found')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Delegate Sign Off')).toBeVisible();
    // The reported symptom: this read "(Text)", which is what the editor was
    // about to rewrite the tag into.
    await expect(page.getByText('(Signature)')).toBeVisible();
    await expect(page.getByText('(Text)')).toHaveCount(0);
  });

  test('offers Signature in the type dropdown, with the row already on it', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Signature Type ${Date.now()}`, { expertRole: 'E2E Signature Expert' });
    await addDocumentStep(page);
    await mockAnalyse(page, [SIGNATURE_ROW]);

    await uploadTemplate(page);
    await expect(page.getByText('1 data field found')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /edit fields/i }).click();

    const typeSelect = page.getByLabel('Field 1 type');
    await expect(typeSelect).toBeVisible();
    await expect(typeSelect).toHaveValue('signature');
    await expect(typeSelect.locator('option[value="signature"]')).toHaveCount(1);
  });

  // The fault that destroyed the author's document: every reviewed row is
  // re-serialised from the model and written back into the stored .docx.
  test('re-emits (approval) after the row is edited, not (optional)', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Signature Roundtrip ${Date.now()}`, { expertRole: 'E2E Signature Expert' });
    await addDocumentStep(page);
    await mockAnalyse(page, [SIGNATURE_ROW]);

    await uploadTemplate(page);
    await expect(page.getByText('1 data field found')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /edit fields/i }).click();

    // Touching the row is what triggered the rewrite — the line is recomputed
    // from the model on every edit.
    await page.getByLabel('Field 1 label').fill('Delegate Sign Off');

    await expect(page.getByText('{{ Delegate Sign Off (approval) }}')).toBeVisible();
    await expect(page.getByText(/\(optional\)/)).toHaveCount(0);
  });

  test('the settings cog offers no constraints for a signature', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Signature Config ${Date.now()}`, { expertRole: 'E2E Signature Expert' });
    await addDocumentStep(page);
    await mockAnalyse(page, [SIGNATURE_ROW]);

    await uploadTemplate(page);
    await expect(page.getByText('1 data field found')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /edit fields/i }).click();
    await page.getByRole('button', { name: 'Configure field 1' }).click();

    // parseTemplateField rejects a signature carrying a length, bound or a
    // required flag, so offering the controls would produce an unsaveable line.
    await expect(page.getByText(/filled by the approval step that signs it/i)).toBeVisible();
    await expect(page.getByRole('switch', { name: /required/i })).toHaveCount(0);
    await expect(page.locator('#field-maxlen')).toHaveCount(0);
  });

  test('documents (approval) in the complete annotation reference', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Signature Reference ${Date.now()}`, { expertRole: 'E2E Signature Expert' });
    await addDocumentStep(page);
    // A document with no placeholders routes to the "no fields yet" panel, which
    // is where the reference is reachable from.
    await mockAnalyse(page, []);

    await uploadTemplate(page);
    await expect(page.getByText('No data fields yet')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /complete list of annotations/i }).click();

    await expect(page.getByText('{{ Delegate Sign Off (approval) }}')).toBeVisible();
  });
});

test.describe('fix: a lone signature slot is bound rather than assumed', () => {
  test('shows the slot dropdown when the subject step declares a signature', async ({ page }) => {
    const flowId = requireSeedFixtures().approvalSubjectFlowId;

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_200);

    // The delegate approval step, whose subject is the document step carrying
    // the signature slots.
    await page.locator('.react-flow__node', { hasText: 'Delegate sign-off' }).first().dblclick();
    await expect(page.locator('#approval-subject')).toBeVisible({ timeout: 10_000 });

    // Before the fix this control only appeared at two or more slots, so a
    // single-signature template left signatureFieldKey empty and DecideApproval
    // read null — the document was never signed.
    const slot = page.locator('[data-approval-signature-slot]');
    await expect(slot).toBeVisible();
    await expect(slot).not.toHaveValue('');
  });
});
