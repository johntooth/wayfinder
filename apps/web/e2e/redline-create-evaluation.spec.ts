/**
 * redline-create-evaluation.spec.ts
 *
 * The create surface (redline delivery-plan §2 item 1). Before it, an evaluation
 * existed only if somebody ran apps/web/scripts/seed-redline-evaluation.ts over a
 * hand-written manifest, so the specialist the product is for could not start a
 * tender at all.
 *
 * This is the item's exit test: a specialist reaches /evaluations/new from the
 * index, picks a staged corpus, names the tender, says which brand each response
 * belongs to and which fields it is read against, and finds the result on
 * /evaluations without a terminal having been opened.
 *
 * Composing the evaluation used to be the whole story, landing on a grouping
 * stub with documents and no responses — WorkflowController.populate
 * (redline-web) existed but nothing served called it. The fork mount closes
 * that: `create` now drives populate itself, so the live test below lands on
 * the review grid with responses that carry source anchors, not a stub. A
 * population failure is not a create failure — it is carried on the response
 * as its own state and still lands the specialist on the (unpopulated)
 * evaluation, at /grouping with the reason shown, rather than a rejected
 * mutation; that path has no live corpus fixture that reliably fails
 * mid-read, so it stays proven at the procedure level
 * (src/server/routers/evaluation.test.ts).
 *
 * Split the way the index spec is. The route, its gate and the submit rules are
 * client-side and need nothing staged, so those tests always run. The create
 * itself needs a corpus the sidecar has already staged *and no evaluation over
 * it* — the create refuses a claimed corpus with ALREADY_EXISTS, which is why
 * this gates on its own E2E_REDLINE_STAGED_CORPUS_ID rather than reusing
 * E2E_REDLINE_EVALUATION_ID: that one names a corpus already claimed. It lands
 * with the live corpus run (§2 item 3) and skips until then, matching the fork's
 * other seed-gated specs.
 *
 * Runs with the shared admin session, who holds evaluation:create via the admin
 * wildcard. The non-admin halves of the gate are proven where a browser cannot
 * reach them: src/app/(user)/evaluations/new/page.test.tsx for the route and
 * src/server/routers/evaluation.test.ts for the procedure.
 */

import { test, expect } from './helpers/base';

const STAGED_CORPUS_ID = process.env.E2E_REDLINE_STAGED_CORPUS_ID;

test.describe('redline create evaluation', () => {
  test('reaches the create surface from the index without knowing the URL', async ({
    page,
    consoleLogs,
  }) => {
    await page.goto('/evaluations');

    await page.getByTestId('new-evaluation').click();

    await expect(page).toHaveURL(/\/evaluations\/new$/);
    await expect(page.getByRole('heading', { name: 'New evaluation' })).toBeVisible();
    await page.screenshot({
      path: 'screenshots/redline-create-evaluation.png',
      fullPage: true,
    });

    const jsErrors = consoleLogs.filter((log) => log.type === 'error');
    expect(
      jsErrors,
      `JS errors on the create surface:\n${jsErrors.map((error) => error.text).join('\n')}`,
    ).toHaveLength(0);
  });

  test('does not serve the create surface to a caller with no session', async ({ browser }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await anonymous.newPage();

    await page.goto('/evaluations/new');

    await expect(page).not.toHaveURL(/\/evaluations\/new$/);
    await expect(page.getByRole('heading', { name: 'New evaluation' })).toBeHidden();
    await anonymous.close();
  });

  // A half-filled form must not reach the mutation: CreateEvaluation refuses a
  // blank brand and a corpus with no fields, and a rejected create is a worse
  // first experience than a button that has not lit up yet.
  test('keeps the create button disabled until the form can produce an evaluation', async ({
    page,
  }) => {
    await page.goto('/evaluations/new');

    await expect(page.getByTestId('create-evaluation')).toBeDisabled();

    await page.getByTestId('evaluation-name').fill('Water treatment panel 2026');
    await page.getByLabel('Field 1 name').fill('Warranty');
    await page.getByLabel('Field 1 definition').fill('The warranty period offered.');

    // Still no corpus and so no documents, which is the one thing a specialist
    // cannot type their way past.
    await expect(page.getByTestId('create-evaluation')).toBeDisabled();
  });

  test('creates a named evaluation over a staged corpus and lands on responses with source anchors', async ({
    page,
  }) => {
    test.skip(
      !STAGED_CORPUS_ID,
      'Needs a staged, unclaimed redline corpus — runs with E2E_REDLINE_STAGED_CORPUS_ID set.',
    );

    const name = `E2E tender ${Date.now()}`;

    await page.goto('/evaluations/new');

    await page.getByTestId('corpus-select').selectOption(STAGED_CORPUS_ID as string);
    await page.getByTestId('evaluation-name').fill(name);

    const firstDocument = page.getByTestId('staged-document').first();
    await expect(firstDocument).toBeVisible();
    await firstDocument.getByRole('checkbox').check();
    await firstDocument.getByRole('textbox').fill('Acme');

    await page.getByLabel('Field 1 name').fill('Warranty');
    await page.getByLabel('Field 1 definition').fill('The warranty period offered and what it covers.');

    await page.getByTestId('create-evaluation').click();

    // The fork mount: create() drives WorkflowController.populate itself, so
    // the specialist lands directly on the review grid rather than the
    // grouping stub — the evaluation arrives with responses built, not with
    // documents and none.
    await expect(page).toHaveURL(
      new RegExp(`/evaluations/${STAGED_CORPUS_ID}/review$`),
    );

    const link = page.getByTestId('review-source-link').first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`/evaluations/${STAGED_CORPUS_ID}/documents/.+element=`),
    );

    await page.goto('/evaluations');
    await expect(
      page.getByTestId('evaluation-link').filter({ hasText: name }),
    ).toBeVisible();
  });
});
