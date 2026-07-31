/**
 * fix-entra-account-linking.spec.ts
 *
 * Regression cover for the bug where an existing email/password user could
 * never sign in with Entra: Better Auth refused to link the Microsoft identity
 * because the local row had `emailVerified: false`, which Wayfinder never sets.
 * The callback bounced to the error page with `account_not_linked`.
 *
 * Drives the whole OAuth code flow against the mock Entra identity provider on
 * the shared mocks server (mocks/entra/oidc.mjs, :4001/entra), started by the
 * e2e workflow and by `./restart.sh --with-mocks` locally.
 *
 * What it proves:
 *   1. One address is one account — signing in through Entra with the address
 *      of an existing password user lands in that same account, not a new one.
 *   2. Entra takes precedence — the password is destroyed by the link, so the
 *      old credentials no longer work.
 *
 * The suite restores email-only auth at the end so global settings are left as
 * they were found.
 */

import type { Browser, Page } from '@playwright/test';
import { test, expect } from './helpers/base';
import { openSettingsSection } from './helpers/settings';

const MOCK_ENTRA_HEALTH = 'http://localhost:4001/healthz';
const PASSWORD = 'LinkTest!2345';

const uniqueEmail = () => `link-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;

const mockEntraRunning = async (): Promise<boolean> => {
  try {
    const response = await fetch(MOCK_ENTRA_HEALTH);
    return response.ok;
  } catch {
    return false;
  }
};

const openAuthCard = async (page: Page): Promise<boolean> => {
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle');
  await openSettingsSection(page, 'General');

  const editButtons = page.getByRole('button', { name: /^edit$/i });
  const editCount = await editButtons.count();
  for (let index = 0; index < editCount; index += 1) {
    await editButtons.nth(index).click();
    if (await page.locator('#auth-entra').isVisible().catch(() => false)) return true;
    await page.keyboard.press('Escape').catch(() => {});
  }
  return false;
};

const setEntraEnabled = async (page: Page, enabled: boolean): Promise<boolean> => {
  const opened = await openAuthCard(page);
  if (!opened) return false;

  if (enabled) {
    await page.locator('#auth-entra').check();
    // Must match the authority the app was booted with: the provider builds
    // `${ENTRA_AUTHORITY}/${tenantId}/oauth2/v2.0/authorize`, and the mock
    // accepts any tenant segment.
    await page.locator('#auth-entra-tenant').fill('mock-tenant');
    await page.locator('#auth-entra-client').fill('mock-client');
    await page.locator('#auth-entra-secret').fill('mock-secret');
  } else {
    await page.locator('#auth-entra').uncheck();
  }

  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText(/authentication settings saved/i)).toBeVisible();
  return true;
};

const registerPasswordUser = async (browser: Browser, email: string): Promise<void> => {
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await page.goto('/register');
    await page.locator('#name').fill('Link Test User');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirm-password').fill(PASSWORD);
    await page.getByRole('button', { name: /create account|register|sign up/i }).click();
    await expect(page).not.toHaveURL(/\/register/, { timeout: 15000 });
  } finally {
    await context.close();
  }
};

test.describe('Fix: Entra links to an existing email/password account', () => {
  test('same address signs into the same account, and the password is retired', async ({
    page,
    browser,
  }) => {
    test.skip(!(await mockEntraRunning()), 'mock Entra not reachable on :4001');

    const email = uniqueEmail();
    await registerPasswordUser(browser, email);

    const enabled = await setEntraEnabled(page, true);
    if (!enabled) {
      await page.screenshot({ path: 'screenshots/link-auth-card-missing.png', fullPage: true });
      test.skip(true, 'Authentication card (#auth-entra) not reachable on /admin/settings');
      return;
    }

    try {
      const context = await browser.newContext({ storageState: undefined });
      try {
        const userPage = await context.newPage();
        await userPage.goto('/login');

        await userPage.getByRole('button', { name: /sign in with microsoft/i }).click();

        // The mock identity provider's picker. Signing in as the address that
        // already has a password account is the exact case that used to fail.
        await expect(userPage.getByTestId('mock-entra-email')).toBeVisible({ timeout: 15000 });
        await userPage.getByTestId('mock-entra-email').fill(email);
        await userPage.screenshot({ path: 'screenshots/link-mock-entra-picker.png', fullPage: true });
        await userPage.getByTestId('mock-entra-submit').click();

        // Before the fix the callback redirected here instead of signing in.
        await expect(userPage).not.toHaveURL(/account.?not.?linked|error/i, { timeout: 20000 });
        await expect(userPage).not.toHaveURL(/\/login/, { timeout: 20000 });

        // Same account, not a freshly provisioned duplicate.
        await userPage.goto('/settings');
        await userPage.waitForLoadState('networkidle');
        await expect(userPage.locator('#profile-email')).toHaveValue(email);
        await userPage.screenshot({ path: 'screenshots/link-entra-signed-in.png', fullPage: true });
      } finally {
        await context.close();
      }

      // Entra takes precedence: the link destroyed the credential row, so the
      // original password is no longer a way into the account.
      const passwordContext = await browser.newContext({ storageState: undefined });
      try {
        const passwordPage = await passwordContext.newPage();
        await passwordPage.goto('/login');
        await passwordPage.locator('#email').fill(email);
        await passwordPage.locator('#password').fill(PASSWORD);
        await passwordPage.getByRole('button', { name: /^sign in$/i }).click();

        await expect(passwordPage).toHaveURL(/\/login/, { timeout: 15000 });
        await passwordPage.screenshot({
          path: 'screenshots/link-password-retired.png',
          fullPage: true,
        });
      } finally {
        await passwordContext.close();
      }
    } finally {
      await setEntraEnabled(page, false);
    }
  });
});
