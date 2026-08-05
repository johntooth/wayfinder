/**
 * phase-container-distribution.spec.ts
 *
 * The container distribution phase is mostly build and CI machinery, but it has
 * exactly one user-visible contract, and it is the one worth defending: the
 * version a running instance reports must be the version it was built from.
 *
 * next.config.ts inlines the repo-root VERSION file into NEXT_PUBLIC_APP_VERSION
 * at build time, which is what makes a published image version-stamped and
 * immutable (ADR-046 §2). If that inlining ever breaks, the About modal falls
 * back to the literal string "unknown" — and an operator asking "which version
 * is this?" during an upgrade gets no answer. That is a silent failure in
 * production and a loud one here.
 *
 * Assertions are about what a user can see in the About modal, never about the
 * build pipeline that put it there.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './helpers/base';

const repoRoot = join(__dirname, '..', '..', '..');
const expectedVersion = readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim();

async function openAboutModal(page: import('@playwright/test').Page) {
  await page.goto('/chats');
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'About' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('container distribution — the running app reports its build version', () => {
  test('the About modal shows the version this build was stamped with', async ({ page }) => {
    await openAboutModal(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('About Wayfinder')).toBeVisible();
    await expect(dialog.getByText(`Version ${expectedVersion}`)).toBeVisible();
  });

  test('the version is never the "unknown" fallback', async ({ page }) => {
    // The fallback is what renders when NEXT_PUBLIC_APP_VERSION was not inlined
    // at build time — a broken build that still starts and serves pages, so
    // nothing else in the suite would catch it.
    await openAboutModal(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Version unknown')).toHaveCount(0);

    const versionLine = await dialog.getByText(/^Version /).textContent();
    expect(versionLine).toMatch(/^Version \d+\.\d+\.\d+/);
  });
});
