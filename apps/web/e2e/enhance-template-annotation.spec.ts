/**
 * enhance-template-annotation.spec.ts
 *
 * Covers the guided annotation upload flow (v0.21.3): uploading a document into
 * a "Generate document" step now opens a guided modal that detects, branches,
 * lets the author review fields through structured controls, and only then
 * persists an annotated template.
 *
 * What is tested:
 *   1. A filled example is detected, demands explicit confirmation that its
 *      values will be replaced, then shows AI-inferred fields with their
 *      original value and confidence.
 *   2. A low-confidence field blocks saving until it is explicitly confirmed.
 *   3. The raw annotation string beneath each row updates live as the author
 *      edits the field name and type — the teaching surface for the Word
 *      round-trip.
 *   4. An already-annotated document offers "Continue with these" and saves.
 *   5. The config icon renders in an accent colour when a non-default option is
 *      set, in the structured conversation editor as well (the retrofit).
 */

import { test, expect } from './helpers/base';
import type { Page, Route } from '@playwright/test';

const FILLED_TEXT =
  'This agreement is made with Acme Pty Ltd for catering services.\nThe total value is $184,500.00.';

const fakeDocx = () => Buffer.from('PK\x03\x04 fake docx content');

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Template Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await page.waitForURL(/\/flows\/[^/]+\/config$/, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

async function addDocumentStep(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: '+ Create your first step in your workflow' })
    .click();
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
  await page.locator('#node-name').fill('Draft the agreement');
  await page.locator('#ai-instruction').fill('Gather the agreement details.');
  await page.locator('label', { hasText: 'Generate document' }).click();
  // The step must exist before a template can be attached to it.
  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  await page.locator('.react-flow__node').first().dblclick();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
}

async function mockAnalyse(page: Page, body: Record<string, unknown>): Promise<void> {
  await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template\/analyse$/, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function mockSuggest(page: Page, rows: unknown[]): Promise<void> {
  await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template\/suggest$/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows }),
    });
  });
}

async function mockSave(page: Page): Promise<{ saved: () => boolean }> {
  let saved = false;
  await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template$/, async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    // The request body cannot be read back here — both postData() and
    // postDataBuffer() are null for a multipart body carrying binary file
    // content. What the payload contains is asserted by the unit tests for
    // buildAnnotationEdits; this only records that the flow reached the save.
    saved = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        path: 'templates/mock-node/agreement.docx',
        filename: 'agreement.docx',
        tagCount: 1,
        templateContentLength: 42,
        documentTemplateContent: 'Made with {{ Supplier Name (text) }}.',
        documentTemplateFields: [
          { key: 'supplier_name', label: 'Supplier Name', type: 'text', optional: false, raw: 'Supplier Name (text)' },
        ],
        documentTemplateFormat: 'docx',
        indexed: true,
        chunkCount: 1,
      }),
    });
  });
  return { saved: () => saved };
}

async function uploadTemplate(page: Page): Promise<void> {
  await page.locator('input[type="file"][accept=".docx,.xlsx"]').setInputFiles({
    name: 'agreement.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: fakeDocx(),
  });
}

test.describe('enhance: guided annotation upload', () => {
  test('a filled example confirms intent, then presents AI fields for review', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Template Annotation ${Date.now()}`);
    await addDocumentStep(page);

    await mockAnalyse(page, {
      filename: 'agreement.docx',
      format: 'docx',
      classification: 'filled',
      documentText: FILLED_TEXT,
      rows: [],
    });
    await mockSuggest(page, [
      {
        key: 'supplier_name:0',
        kind: 'span',
        line: 'Supplier Name (text)',
        occurrences: [{ sourceText: 'Acme Pty Ltd', occurrence: 0 }],
        context: 'This agreement is made with Acme Pty Ltd for catering services.',
        originalValue: 'Acme Pty Ltd',
        confidence: 92,
        insertAfter: false,
        locked: false,
      },
    ]);
    const save = await mockSave(page);

    await uploadTemplate(page);

    // 1. The filled-example branch names the destructive part concretely and
    //    will not proceed without an explicit confirmation.
    await expect(page.getByText('This looks like a completed document')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Use this as a pattern' }).click();
    await expect(page.getByText(/will be replaced with fields/i)).toBeVisible();
    await page.screenshot({ path: 'screenshots/enhance-template-annotation-confirm.png', fullPage: true });
    await page.getByRole('button', { name: 'Yes, use it as a pattern' }).click();

    // 2. The review grid shows the value being replaced and the confidence, so
    //    the author can verify the inference caught the right span.
    // Exact, since the surrounding-context line quotes the same value.
    await expect(page.getByText('Acme Pty Ltd', { exact: true })).toBeVisible({ timeout: 10_000 });
    // A value span is replaced outright; a caption-anchored row would read
    // "Goes after" instead, since a caption must survive annotation.
    await expect(page.getByText(/^Replaces/)).toBeVisible();
    await expect(page.getByText(/High confidence/)).toBeVisible();
    await expect(page.getByText('{{ Supplier Name (text) }}')).toBeVisible();
    await page.screenshot({ path: 'screenshots/enhance-template-annotation-review.png', fullPage: true });

    await page.getByRole('button', { name: 'Save template' }).click();

    // 3. The annotated template is persisted and reflected back in node config.
    await expect(page.getByText('agreement.docx').first()).toBeVisible({ timeout: 10_000 });
    expect(save.saved()).toBe(true);
    // The output type survives the round-trip through the guided modal.
    await expect(page.locator('input[type="radio"][value="generate_document"]')).toBeChecked();
  });

  test('a low-confidence field blocks saving until it is confirmed', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Template Low Confidence ${Date.now()}`);
    await addDocumentStep(page);

    await mockAnalyse(page, {
      filename: 'agreement.docx',
      format: 'docx',
      classification: 'filled',
      documentText: FILLED_TEXT,
      rows: [],
    });
    await mockSuggest(page, [
      {
        key: 'supplier_name:0',
        kind: 'span',
        line: 'Supplier Name (text)',
        occurrences: [{ sourceText: 'Acme Pty Ltd', occurrence: 0 }],
        context: 'This agreement is made with Acme Pty Ltd.',
        originalValue: 'Acme Pty Ltd',
        confidence: 20,
        insertAfter: false,
        locked: false,
      },
    ]);
    await mockSave(page);

    await uploadTemplate(page);
    await page.getByRole('button', { name: 'Use this as a pattern' }).click();
    await page.getByRole('button', { name: 'Yes, use it as a pattern' }).click();

    const saveButton = page.getByRole('button', { name: 'Save template' });
    await expect(page.getByText(/Low confidence/)).toBeVisible({ timeout: 10_000 });
    await expect(saveButton).toBeDisabled();
    await expect(page.getByText(/Confirm the fields the AI was unsure about/i)).toBeVisible();

    await page.getByRole('button', { name: /confirm it is right/i }).click();
    await expect(saveButton).toBeEnabled();
  });

  test('the raw annotation string updates live as the field is edited', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Template Live Line ${Date.now()}`);
    await addDocumentStep(page);

    await mockAnalyse(page, {
      filename: 'agreement.docx',
      format: 'docx',
      classification: 'annotated',
      documentText: 'Made with {{ Supplier Name }}.',
      rows: [
        {
          key: 'supplier_name',
          kind: 'tag',
          line: 'Supplier Name',
          occurrences: [{ sourceText: '{{ Supplier Name }}', occurrence: 0 }],
          context: 'Made with {{ Supplier Name }}.',
          originalValue: null,
          confidence: null,
          insertAfter: false,
          locked: false,
        },
      ],
    });
    await mockSave(page);

    await uploadTemplate(page);

    // The branch step lists the data fields it found, with their type, before
    // asking the author to decide.
    await expect(page.getByText('Data fields found')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Supplier Name')).toBeVisible();
    await expect(page.getByText('(Text)')).toBeVisible();
    await page.getByRole('button', { name: 'Continue with these' }).click();

    await expect(page.getByText('{{ Supplier Name }}').first()).toBeVisible({ timeout: 5_000 });

    // Changing the type rewrites the raw line immediately, not on blur or save.
    await page.getByLabel('Field 1 type').selectOption('currency');
    await expect(page.getByText('{{ Supplier Name (currency) }}')).toBeVisible();

    // Renaming does the same.
    await page.getByLabel('Field 1 label').fill('Contract Value');
    await expect(page.getByText('{{ Contract Value (currency) }}')).toBeVisible();

    // Switching to a select type sticks even before any choices are added — the
    // type is held in state, not re-derived from a line that cannot carry an
    // empty options list (the reported regression).
    await page.getByLabel('Field 1 type').selectOption('multiselect');
    await expect(page.getByLabel('Field 1 type')).toHaveValue('multiselect');

    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByText('agreement.docx').first()).toBeVisible({ timeout: 10_000 });
  });

  test('downloading to add fields switches to a re-upload panel that restarts the flow', async ({
    page,
  }) => {
    await createFlowAndOpenCanvas(page, `Template Reupload ${Date.now()}`);
    await addDocumentStep(page);

    await mockAnalyse(page, {
      filename: 'agreement.docx',
      format: 'docx',
      classification: 'annotated',
      documentText: 'Made with {{ Supplier Name }}.',
      rows: [
        {
          key: 'supplier_name',
          kind: 'tag',
          line: 'Supplier Name',
          occurrences: [{ sourceText: '{{ Supplier Name }}', occurrence: 0 }],
          context: 'Made with {{ Supplier Name }}.',
          originalValue: null,
          confidence: null,
          insertAfter: false,
          locked: false,
        },
      ],
    });
    await mockSave(page);

    // The download returns the document with annotations inserted; mock it so the
    // fake .docx bytes don't have to be a real document.
    await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template\/annotated$/, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        headers: { 'Content-Disposition': 'attachment; filename="agreement.docx"' },
        body: 'PK\x03\x04 annotated bytes',
      });
    });

    await uploadTemplate(page);
    await expect(page.getByText('Data fields found')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Continue with these' }).click();
    await expect(page.getByText('{{ Supplier Name }}').first()).toBeVisible({ timeout: 5_000 });

    // The Download button hands the annotated document back and switches to the
    // re-upload panel; the download itself is captured so headless does not stall.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download to add fields/i }).click();
    await download;

    await expect(page.getByText(/upload the document here/i)).toBeVisible({ timeout: 5_000 });

    // Re-uploading restarts the flow from detection.
    await page
      .locator('input[type="file"][accept=".docx,.xlsx"]')
      .last()
      .setInputFiles({
        name: 'agreement.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: fakeDocx(),
      });
    await expect(page.getByText('Data fields found')).toBeVisible({ timeout: 10_000 });
  });

  test('the config icon takes an accent colour when a non-default option is set', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Field Cog Accent ${Date.now()}`);

    await page
      .getByRole('button', { name: '+ Create your first step in your workflow' })
      .click();
    await page.getByRole('button', { name: 'Conversational' }).click();
    await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });

    // The retrofit applies to the structured conversation editor too, because
    // both editors render the same row component.
    // Selected by its radio value: "Structured conversation" is a substring of
    // "Unstructured conversation", so a text filter matches both.
    await page.locator('label:has(input[value="structured"])').click();
    await page.getByLabel('Field 1 label').fill('Supplier Name');

    const cog = page.getByRole('button', { name: 'Configure field 1' });
    await expect(cog).toHaveAttribute('data-configured', 'false');

    await cog.click();
    await page.getByRole('switch', { name: /required/i }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(cog).toHaveAttribute('data-configured', 'true');
    await page.screenshot({ path: 'screenshots/enhance-template-annotation-cog-accent.png', fullPage: true });
  });
});
