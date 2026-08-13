/**
 * redline-create-corpus.spec.ts
 *
 * The standalone Create Corpus tab (redline delivery-plan §2 item 1, fork
 * mount). Deliberately not a change to /evaluations/new — ingest and evaluation
 * are different users, so the create flow's "corpus already staged" assumption
 * stays untouched. This surface picks a staged corpus, names the evaluation,
 * authors the allow-listed run config, then creates the evaluation and fires the
 * womblex run — ingest → lens → grouping → build — tracking it through the four
 * states (started / errored / resumable / done).
 *
 * Split the way the create-evaluation spec is. The tab, its gate, the readiness
 * rule and the run-config surface are client-side and need nothing staged, so
 * those tests always run. Firing an actual run needs a staged, unclaimed corpus
 * *and* a live womblex-ingest sidecar to enqueue against, so that half gates on
 * its own env and lands with the live corpus run (§2 item 3), skipping until
 * then — matching the fork's other seed-gated specs.
 *
 * Runs with the shared admin session, who holds evaluation:create via the admin
 * wildcard. The non-admin halves of the gate are proven where a browser cannot
 * reach them: src/app/(user)/create-corpus/page.tsx's notFound() and
 * src/server/routers/evaluation.test.ts for the procedures.
 */

import { test, expect } from './helpers/base';

const STAGED_CORPUS_ID = process.env.E2E_REDLINE_STAGED_CORPUS_ID;

test.describe('redline create corpus', () => {
  test('reaches the tab from the sidebar without knowing the URL', async ({
    page,
    consoleLogs,
  }) => {
    await page.goto('/chats');

    await page.getByRole('link', { name: 'Create Corpus' }).click();

    await expect(page).toHaveURL(/\/create-corpus$/);
    await expect(page.getByRole('heading', { name: 'Create corpus' })).toBeVisible();
    await page.screenshot({
      path: 'screenshots/redline-create-corpus.png',
      fullPage: true,
    });

    const jsErrors = consoleLogs.filter((log) => log.type === 'error');
    expect(
      jsErrors,
      `JS errors on the Create Corpus tab:\n${jsErrors.map((error) => error.text).join('\n')}`,
    ).toHaveLength(0);
  });

  test('does not serve the tab to a caller with no session', async ({ browser }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await anonymous.newPage();

    await page.goto('/create-corpus');

    await expect(page).not.toHaveURL(/\/create-corpus$/);
    await expect(page.getByRole('heading', { name: 'Create corpus' })).toBeHidden();
    await anonymous.close();
  });

  // A half-filled form must not fire a run: the run needs a corpus, a document, a
  // name and at least one field, and a rejected create is a worse first
  // experience than a button that has not lit up yet. renderCreateCorpusView owns
  // trigger.enabled — this proves the DOM honours it.
  test('keeps the start button disabled until the form can fire a run', async ({ page }) => {
    await page.goto('/create-corpus');

    await expect(page.getByTestId('start-run')).toBeDisabled();

    await page.getByTestId('evaluation-name').fill('Water treatment panel 2026');
    await page.getByLabel('Field 1 name').fill('Warranty');
    await page.getByLabel('Field 1 definition').fill('The warranty period offered.');

    // Still no corpus and so no documents, which is the one thing a specialist
    // cannot type their way past.
    await expect(page.getByTestId('start-run')).toBeDisabled();
  });

  // The allow-listed config is inherit-when-blank: the override editors only
  // appear when a group is switched on, so a specialist who touches nothing runs
  // the corpus profile as it ships.
  test('reveals the run-config overrides only when a group is switched on', async ({ page }) => {
    await page.goto('/create-corpus');

    await expect(page.getByLabel('Chunk size in tokens')).toBeHidden();
    await page.getByLabel('Override chunk mode').check();
    await expect(page.getByLabel('Chunk size in tokens')).toBeVisible();

    await expect(page.getByLabel('Default currency')).toBeHidden();
    await page.getByLabel('Override money vocabulary').check();
    await expect(page.getByLabel('Default currency')).toBeVisible();
  });

  test('fires a run over a staged corpus and tracks it to completion', async ({ page }) => {
    test.skip(
      !STAGED_CORPUS_ID,
      'Needs a staged, unclaimed corpus and a live womblex-ingest sidecar — runs with E2E_REDLINE_STAGED_CORPUS_ID set.',
    );

    const name = `E2E corpus ${Date.now()}`;

    await page.goto('/create-corpus');

    await page.getByTestId('corpus-select').selectOption(STAGED_CORPUS_ID as string);
    await page.getByTestId('evaluation-name').fill(name);

    const firstDocument = page.getByTestId('staged-document').first();
    await expect(firstDocument).toBeVisible();
    await firstDocument.getByRole('checkbox').check();
    await firstDocument.getByRole('textbox').fill('Acme');

    await page.getByLabel('Field 1 name').fill('Warranty');
    await page
      .getByLabel('Field 1 definition')
      .fill('The warranty period offered and what it covers.');

    await page.getByTestId('start-run').click();

    // The tracker replaces the form once the run is fired.
    await expect(page.getByTestId('run-tracker')).toBeVisible();

    // A settled run either offers the evaluation or a resume affordance — never an
    // endless spinner. Give the minutes-long run generous headroom.
    await expect(
      page.getByTestId('open-evaluation').or(page.getByTestId('resume-run')),
    ).toBeVisible({ timeout: 300_000 });
  });
});
