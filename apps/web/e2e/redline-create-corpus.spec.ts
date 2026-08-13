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
 * The live half splits again, on cost rather than on infrastructure. Extraction
 * and the money pass are offline and API-free, so a run over those alone drives
 * the whole browser → object store → engine → tracker path for nothing, and runs
 * wherever the stack is up. Chunk, embed and enrich each declare
 * `needs_isaacus_api` in the engine's own STAGE_CONTRACTS, so they are real
 * Isaacus spend and the two tests that reach them gate on
 * E2E_REDLINE_ISAACUS as well. A keyless deployment is not left unproven by
 * that: it is asserted directly, because refusing a paid stage loudly is the
 * behaviour a keyless deployment has.
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

// Set only when the stack behind the sidecar has a live ISAACUS_API_KEY. It
// selects between the two halves of the live surface rather than switching one
// test off: without it the paid stages must fail legibly, with it they must
// carry the corpus through to the evaluation screen.
const ISAACUS = process.env.E2E_REDLINE_ISAACUS;

// A real run extracts a real document, so the fixture has to be a file PyMuPDF
// can open — a `%PDF-1.4` banner in front of prose is not one, and the engine
// rejects it before any stage runs. Written out rather than committed as a
// binary so the bytes the money pass is asserted against stay readable: mupdf
// repairs the absent xref table, and both amounts below are recovered from the
// narrative locus as exact AUD decimals.
const tenderResponsePdf = (): Buffer =>
  Buffer.from(
    `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 260>>stream
BT /F1 12 Tf 72 720 Td (Acme Pty Ltd tender response) Tj ET
BT /F1 12 Tf 72 700 Td (We offer a 24 month warranty on all equipment.) Tj ET
BT /F1 12 Tf 72 680 Td (Total contract price: $1,250,000 excluding GST.) Tj ET
BT /F1 12 Tf 72 660 Td (Annual maintenance fee of $48,000 per annum.) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
%%EOF
`,
    'latin1',
  );

// An extraction pass plus a downstream stage is minutes of real engine work on a
// cold container, and the file-level timeout is 45s. A run test that does not
// raise it fails on the clock rather than on the run.
const RUN_TIMEOUT_MS = 300_000;

// Name, upload and fire, leaving only the stages the caller asked for armed.
const fireRun = async (
  page: import('@playwright/test').Page,
  runName: string,
  stages: readonly string[],
) => {
  await page.goto('/create-corpus');
  await page.getByTestId('run-name').fill(runName);
  await page.getByTestId('document-upload').setInputFiles([
    {
      name: 'acme-response.pdf',
      mimeType: 'application/pdf',
      buffer: tenderResponsePdf(),
    },
  ]);

  for (const stage of ['Chunk', 'Embed', 'Enrich', 'Money']) {
    const box = page.getByLabel(`Run ${stage} stage`);
    if (stages.includes(stage)) await box.check();
    else await box.uncheck();
  }

  await expect(page.getByTestId('start-run')).toBeEnabled();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('run-tracker')).toBeVisible();
};

test.describe('redline create corpus', () => {
  test('reaches the tab from the sidebar without knowing the URL', async ({
    page,
    consoleLogs,
  }) => {
    await page.goto('/chats');

    await page.getByRole('link', { name: 'Create Corpus' }).click();

    // A client-side nav only changes the URL once the route's payload arrives,
    // and in dev mode the first hit compiles the route on demand — longer than
    // the 5s default. The wait is the compile, not the app.
    await expect(page).toHaveURL(/\/create-corpus$/, { timeout: 30_000 });
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

  // The offline exit test: a run named and uploaded from the browser, fired
  // against the real engine, and drained to completion — with no terminal in the
  // loop and no API key anywhere. Every hop is the shipping one: the browser
  // base64s the file to createCorpus, the staged-corpus writer puts it under
  // proc/{runName}/inputs/, the sidecar enqueues it, the engine's own worker
  // extracts it, the money pass annotates the shards, and the tracker polls
  // runStatus until it settles. Only the two paid stages are left off.
  test('fires a real run over the offline stages and drains it to complete', async ({
    page,
  }) => {
    test.skip(
      !RUN_STACK,
      'Needs a live womblex-ingest sidecar and object storage — runs with E2E_REDLINE_RUN_STACK set.',
    );
    test.setTimeout(RUN_TIMEOUT_MS);

    const runName = `e2e-corpus-offline-${Date.now()}`;

    await fireRun(page, runName, ['Money']);

    // A settled run either completes or offers a resume — never an endless
    // spinner. Asserting the pair first means a failed run reports its own error
    // rather than this timing out on the success state.
    await expect(
      page.getByTestId('open-evaluation').or(page.getByTestId('resume-run')),
    ).toBeVisible({ timeout: RUN_TIMEOUT_MS - 60_000 });

    await expect(page.getByTestId('run-tracker')).toContainText('Run complete');

    // The money pass really ran: the tracker lists what the engine completed,
    // not what the form asked for. Extraction is proven by the same assertion —
    // a downstream stage only runs once the worker has drained the run.
    await expect(page.getByTestId('run-tracker')).toContainText('Completed: money');

    // The hand-over is offered from the finished run. The nav carries the same
    // dev-mode on-demand compile the sidebar hop does, so it gets the same room.
    await expect(page.getByTestId('open-evaluation')).toBeVisible();
    await page.getByTestId('open-evaluation').click();
    await expect(page).toHaveURL(/\/evaluations\/new$/, { timeout: 30_000 });
  });

  // The keyless deployment's own behaviour, not a gap in coverage. chunk / embed
  // / enrich each declare needs_isaacus_api in the engine's STAGE_CONTRACTS, so
  // without a key the pass must fail *loudly* — naming the stage that stopped
  // and offering the resume that picks it up once a key is configured. A run
  // that quietly reported success here would leave a corpus with no chunks,
  // which is the failure this state exists to prevent.
  test('fails legibly at the first paid stage when no Isaacus key is configured', async ({
    page,
  }) => {
    test.skip(
      !RUN_STACK,
      'Needs a live womblex-ingest sidecar and object storage — runs with E2E_REDLINE_RUN_STACK set.',
    );
    test.skip(
      !!ISAACUS,
      'Asserts the keyless refusal — with E2E_REDLINE_ISAACUS set the chunk stage is expected to succeed.',
    );
    test.setTimeout(RUN_TIMEOUT_MS);

    const runName = `e2e-corpus-keyless-${Date.now()}`;

    await fireRun(page, runName, ['Chunk', 'Money']);

    // The tracker names the stage that stopped rather than reporting a generic
    // failure — renderRunStatusView's statusLabel over the sidecar's failedStage.
    await expect(page.getByTestId('run-tracker')).toContainText('Chunk stage failed', {
      timeout: RUN_TIMEOUT_MS - 60_000,
    });
    // Scoped to the tracker: the shell carries its own alerts, and the one that
    // matters is the run's own reason for stopping.
    await expect(page.getByTestId('run-tracker').getByRole('alert')).toContainText(
      'ISAACUS_API_KEY',
    );

    // Every failure is resumable — the engine's enqueue is idempotent and a
    // completed stage skips on its published output — so the run offers to pick
    // up rather than making the specialist stage the documents again.
    await expect(page.getByTestId('resume-run')).toBeVisible();

    // The corpus is not handed over from a stopped run: there are no chunks
    // behind it, so /evaluations/new would have nothing to compose over.
    await expect(page.getByTestId('open-evaluation')).toBeHidden();
  });

  // The full hand-over, which needs the paid stages: a corpus is only *pickable*
  // on /evaluations/new once the chunk pass has landed *.chunks.parquet and the
  // run's load has projected it into redline_chunks — the staged-corpus reader
  // queries that table, so an extraction-only run produces no pickable corpus.
  // This is where the two-screen flow used to break: a run that published shards
  // no screen could see.
  test('hands the finished corpus over to the evaluation screen', async ({ page }) => {
    test.skip(
      !RUN_STACK,
      'Needs a live womblex-ingest sidecar and object storage — runs with E2E_REDLINE_RUN_STACK set.',
    );
    test.skip(
      !ISAACUS,
      'The chunk pass that makes a corpus pickable is Isaacus-only — runs with E2E_REDLINE_ISAACUS set.',
    );
    test.setTimeout(RUN_TIMEOUT_MS);

    const runName = `e2e-corpus-${Date.now()}`;

    await fireRun(page, runName, ['Chunk', 'Money']);

    await expect(
      page.getByTestId('open-evaluation').or(page.getByTestId('resume-run')),
    ).toBeVisible({ timeout: RUN_TIMEOUT_MS - 60_000 });

    // The run must have finished, not merely stopped: a resumable run has not
    // produced a corpus for the next screen.
    await expect(page.getByTestId('open-evaluation')).toBeVisible();

    await page.getByTestId('open-evaluation').click();

    await expect(page).toHaveURL(/\/evaluations\/new$/, { timeout: 30_000 });
    await expect(page.getByTestId('corpus-select')).toContainText(runName, {
      timeout: 30_000,
    });
  });
});
