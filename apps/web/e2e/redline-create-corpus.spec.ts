/**
 * redline-create-corpus.spec.ts
 *
 * The standalone Create Corpus tab (fork mount): redline's *ingest* surface.
 * Deliberately not a change to /evaluations/new — ingest and evaluation are
 * different users, and they are different steps. This surface names the run,
 * uploads the raw documents into its input prefix, authors the allow-listed run
 * config and fires the womblex run, tracking it through the four states
 * (started / errored / resumable / done). Composing the evaluation over the
 * corpus the run produced is /evaluations/new's job, which the tracker links to.
 *
 * It does not name brands or fields: womblex mints each document's source_hash
 * on extract, so there is nothing to describe until the run has drained.
 *
 * Split the way the create-evaluation spec is. The tab, its gate, the readiness
 * rule and the run-config surface are client-side and need nothing staged, so
 * those tests always run. Firing an actual run needs a live womblex-ingest
 * sidecar to enqueue against and object storage to stage into, so that half
 * gates on its own env and lands with the live corpus run, skipping until then
 * — matching the fork's other seed-gated specs.
 *
 * Runs with the shared admin session, who holds evaluation:create via the admin
 * wildcard. The non-admin halves of the gate are proven where a browser cannot
 * reach them: src/app/(user)/create-corpus/page.tsx's notFound() and
 * src/server/routers/evaluation.test.ts for the procedures.
 */

import { test, expect } from './helpers/base';

// A live run needs the sidecar and object storage, not a pre-staged corpus:
// this surface stages its own documents, which is the whole point of it.
const RUN_STACK = process.env.E2E_REDLINE_RUN_STACK;

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

    await page.getByTestId('run-name').fill('tender-2026-water');

    // Named but with nothing to extract. The engine refuses an empty input
    // prefix anyway, so lighting the button here would only buy a failed run.
    await expect(page.getByTestId('start-run')).toBeDisabled();
    await expect(page.getByTestId('upload-summary')).toHaveText('No documents chosen yet');
  });

  // The surface has no brand or field inputs at all. This is the half of the
  // build that was deletion: naming a brand against a document womblex has not
  // yet read is not something a specialist can do, and asking them to was what
  // made the tab only able to re-run an already-extracted corpus.
  test('asks for no brands and no fields — the run has not read anything yet', async ({
    page,
  }) => {
    await page.goto('/create-corpus');

    await expect(page.getByTestId('run-name')).toBeVisible();
    await expect(page.getByTestId('document-upload')).toBeVisible();
    await expect(page.getByLabel('Field 1 name')).toBeHidden();
    await expect(page.getByTestId('corpus-select')).toBeHidden();
  });

  // Chosen files are listed before anything is uploaded, so a specialist can see
  // — and correct — what is about to cost them a run.
  test('lists the chosen documents, and lets one be removed before firing', async ({ page }) => {
    await page.goto('/create-corpus');

    await page.getByTestId('document-upload').setInputFiles([
      { name: 'acme-response.pdf', mimeType: 'application/pdf', buffer: Buffer.from('acme') },
      { name: 'beta-response.pdf', mimeType: 'application/pdf', buffer: Buffer.from('beta') },
    ]);

    await expect(page.getByTestId('upload-summary')).toHaveText('2 documents to upload');

    await page.getByRole('button', { name: 'Remove beta-response.pdf' }).click();

    await expect(page.getByTestId('upload-summary')).toHaveText('1 document to upload');
    await expect(page.getByTestId('upload-list')).toContainText('acme-response.pdf');
    await expect(page.getByTestId('upload-list')).not.toContainText('beta-response.pdf');
  });

  // Name plus a document plus a stage is the whole readiness rule.
  test('arms the start button once the run has a name and a document', async ({ page }) => {
    await page.goto('/create-corpus');

    await page.getByTestId('run-name').fill('tender-2026-water');
    await page.getByTestId('document-upload').setInputFiles([
      { name: 'acme-response.pdf', mimeType: 'application/pdf', buffer: Buffer.from('acme') },
    ]);

    await expect(page.getByTestId('start-run')).toBeEnabled();

    // Turning every stage off disarms it again — a run with no pass is not a run.
    for (const stage of ['Chunk', 'Embed', 'Enrich', 'Money']) {
      await page.getByLabel(`Run ${stage} stage`).uncheck();
    }
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

  // The exit test: a run named and uploaded from the browser, fired, drained,
  // and its corpus visible to /evaluations/new — with no terminal in the loop.
  test('names a run, uploads a document, fires it, and hands the corpus over', async ({
    page,
  }) => {
    test.skip(
      !RUN_STACK,
      'Needs a live womblex-ingest sidecar and object storage — runs with E2E_REDLINE_RUN_STACK set.',
    );

    const runName = `e2e-corpus-${Date.now()}`;

    await page.goto('/create-corpus');

    await page.getByTestId('run-name').fill(runName);
    await page.getByTestId('document-upload').setInputFiles([
      {
        name: 'acme-response.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nAcme response: 24 month warranty. Total $1,250,000.\n'),
      },
    ]);

    await page.getByTestId('start-run').click();

    // The tracker replaces the form once the run is fired.
    await expect(page.getByTestId('run-tracker')).toBeVisible();

    // A settled run either hands the corpus over or offers a resume — never an
    // endless spinner. Give the minutes-long run generous headroom.
    await expect(
      page.getByTestId('open-evaluation').or(page.getByTestId('resume-run')),
    ).toBeVisible({ timeout: 300_000 });

    // The run must have finished, not merely stopped: a resumable run has not
    // produced a corpus for the next screen.
    await expect(page.getByTestId('open-evaluation')).toBeVisible();

    // The hand-over: the corpus this run produced is loaded and pickable on
    // /evaluations/new. Without the run's own shard load this is exactly where
    // the two-screen flow used to break — a run that published shards no screen
    // could see.
    await page.getByTestId('open-evaluation').click();

    await expect(page).toHaveURL(/\/evaluations\/new$/);
    await expect(page.getByTestId('corpus-select')).toContainText(runName, {
      timeout: 30_000,
    });
  });
});
