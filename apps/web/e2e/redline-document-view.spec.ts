/**
 * redline-document-view.spec.ts
 *
 * The document view behind the review grid's provenance deep-link (ADR-0019).
 * redline-review-grid.spec.ts asserts the href *pattern* and stops there — every
 * one of those links 404'd until this route existed. This is the assertion that
 * spec stops short of: a specialist clicks a review row's source link and lands
 * on the document view, scrolled to the cited element.
 *
 * Runs against the served fork with the shared admin session, who holds
 * evaluation:review via the admin wildcard. Like its siblings it needs a real
 * redline evaluation (E2E_REDLINE_EVALUATION_ID, which lands with the live corpus
 * run) and skips otherwise. The pure ordering/anchor shaping stays proven in the
 * redline-web vitest suite (document-view.test.ts); this spec pins the served
 * navigation and DOM that shaping binds to.
 */

import { test, expect } from './helpers/base';

const EVALUATION_ID = process.env.E2E_REDLINE_EVALUATION_ID;

test.describe('redline document view', () => {
  test.beforeEach(() => {
    test.skip(
      !EVALUATION_ID,
      'Needs a redline evaluation the CI seed does not create yet (waits on the live corpus run) — runs with E2E_REDLINE_EVALUATION_ID set.',
    );
  });

  test('a review row source link lands on the document, scrolled to the cited element', async ({
    page,
  }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/review`);

    const link = page.getByTestId('review-source-link').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href, 'the review grid renders a source deep-link').toBeTruthy();
    const citedElement = new URL(href!, page.url()).searchParams.get('element');
    expect(citedElement, 'the deep-link cites an element').toBeTruthy();

    await link.click();

    // The route the link points at is served — this is what used to 404.
    await expect(page).toHaveURL(
      new RegExp(`/evaluations/${EVALUATION_ID}/documents/[^?]+\\?.*element=`),
    );
    await expect(page.getByRole('heading', { name: 'Source document' })).toBeVisible();
    await expect(page.getByTestId('document-elements')).toBeVisible();

    // The cited element is the one the view anchored, and it is in the viewport
    // rather than merely present somewhere down the page. toBeInViewport retries:
    // the scroll runs in an effect after the query settles, so the element is
    // rendered before it is scrolled to.
    const anchored = page.getByTestId('document-anchored-element');
    await expect(anchored).toHaveAttribute('id', `element-${citedElement}`);
    await expect(page.getByTestId('document-anchor-missing')).toHaveCount(0);
    await expect(anchored).toBeInViewport();

    await page.screenshot({ path: 'screenshots/redline-document-view.png', fullPage: true });
  });

  test('returns to the review grid the link was clicked from', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/review`);
    await page.getByTestId('review-source-link').first().click();

    await page.getByTestId('back-to-review').click();

    await expect(page).toHaveURL(new RegExp(`/evaluations/${EVALUATION_ID}/review$`));
    await expect(page.getByTestId('review-table')).toBeVisible();
  });

  // A hand-typed or stale link must say the passage has moved rather than render
  // the top of the document as though it were the cited one.
  test('says so when the cited element is not in the extraction', async ({ page }) => {
    await page.goto(`/evaluations/${EVALUATION_ID}/review`);
    const href = await page.getByTestId('review-source-link').first().getAttribute('href');
    const stale = new URL(href!, page.url());
    stale.searchParams.set('element', '999999');

    await page.goto(`${stale.pathname}${stale.search}`);

    await expect(page.getByTestId('document-anchor-missing')).toBeVisible();
    await expect(page.getByTestId('document-anchored-element')).toHaveCount(0);
    await expect(page.getByTestId('document-elements')).toBeVisible();
  });
});
