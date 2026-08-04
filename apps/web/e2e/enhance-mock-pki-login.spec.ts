/**
 * enhance-mock-pki-login.spec.ts
 *
 * Drives the PKI / client-certificate login method end to end against the mock
 * mTLS reverse proxy on the shared mocks server (mocks/pki/proxy.mjs,
 * :4001/pki), the PKI counterpart to the mock Entra provider at :4001/entra.
 *
 * PKI has no identity provider to point at — the app's contract is with a proxy
 * that terminates mTLS and forwards `x-ssl-client-*` headers from an IP in
 * PKI_TRUSTED_PROXY_IPS. So the mock stands in for nginx: its picker forwards
 * the chosen certificate to /api/auth/cert, replays the session cookie the app
 * returns, and hands the browser back to the app.
 *
 * What it proves:
 *   1. A certificate signs in and provisions an account just-in-time.
 *   2. The address inside the certificate is the account key — presenting a
 *      certificate for an address that already has a password account lands in
 *      that same account rather than provisioning a second one, and a re-issued
 *      certificate (new fingerprint, same address) keeps that account too.
 *   3. A certificate that fails chain verification mints no session.
 *
 * Requires the app booted in PKI mode — `./restart.sh --with-pki` locally, or
 * the `e2e-pki` job in .github/workflows/e2e.yml. The suite skips itself when
 * the mock is unreachable or PKI auth is off, the same way the Entra spec does.
 */

import type { Browser, Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const MOCKS_ORIGIN = process.env.MOCKS_ORIGIN ?? 'http://localhost:4001';
const MOCK_PKI_PICKER = `${MOCKS_ORIGIN}/pki/connect`;
const PASSWORD = 'CertTest!2345';

const uniqueEmail = () => `cert-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;

const mocksRunning = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${MOCKS_ORIGIN}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
};

// The adapter is built unconditionally now, so its presence says nothing: the
// route answers 403 when certificate sign-in is not usable — disabled in
// settings, or enabled with PKI_TRUSTED_PROXY_IPS unset (ADR-042 §1) — and 401
// when it is usable but the caller is not a trusted proxy.
const pkiAuthEnabled = async (baseURL: string): Promise<boolean> => {
  try {
    const response = await fetch(`${baseURL}/api/auth/cert`, { method: 'POST', redirect: 'manual' });
    return response.status !== 403 && response.status !== 404;
  } catch {
    return false;
  }
};

const presentCertificate = async (
  page: Page,
  options: { email: string; redirect?: string; failVerification?: boolean },
): Promise<void> => {
  const picker = new URL(MOCK_PKI_PICKER);
  picker.searchParams.set('redirect', options.redirect ?? '/chats');
  await page.goto(picker.toString());

  await expect(page.getByTestId('mock-pki-email')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('mock-pki-email').fill(options.email);
  if (options.failVerification) await page.getByTestId('mock-pki-fail-verification').check();
  await page.getByTestId('mock-pki-submit').click();
};

const registerPasswordUser = async (browser: Browser, email: string): Promise<void> => {
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await page.goto('/register');
    await page.locator('#name').fill('Cert Test User');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirm-password').fill(PASSWORD);
    await page.getByRole('button', { name: /create account|register|sign up/i }).click();
    await expect(page).not.toHaveURL(/\/register/, { timeout: 15000 });
  } finally {
    await context.close();
  }
};

test.describe('Mock PKI: client-certificate login', () => {
  test.beforeEach(async ({ baseURL }) => {
    test.skip(!(await mocksRunning()), `mocks server not reachable on ${MOCKS_ORIGIN}`);
    test.skip(
      !(await pkiAuthEnabled(baseURL ?? 'http://localhost:3000')),
      'certificate sign-in is not usable — boot with ./restart.sh --with-pki',
    );
  });

  test('a certificate signs in and provisions the account just-in-time', async ({ browser }) => {
    const email = uniqueEmail();
    const context = await browser.newContext({ storageState: undefined });

    try {
      const page = await context.newPage();
      await presentCertificate(page, { email, redirect: '/chats' });

      // The mock replays the app's session cookie, so the browser arrives at
      // the app already authenticated rather than bouncing back to sign-in.
      await expect(page).toHaveURL(/\/chats/, { timeout: 20000 });

      await page.goto('/settings');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#profile-email')).toHaveValue(email);
      await page.screenshot({ path: 'screenshots/pki-cert-signed-in.png', fullPage: true });
    } finally {
      await context.close();
    }
  });

  test('the address in the certificate is the account key, not the fingerprint', async ({
    browser,
  }) => {
    const email = uniqueEmail();
    await registerPasswordUser(browser, email);

    // A certificate for an address that already has an account must land in
    // that account. The mock derives the fingerprint from the address, so the
    // second presentation below also covers a re-issue: same person, same
    // account, whatever the certificate serial says.
    for (const attempt of ['first', 'second']) {
      const context = await browser.newContext({ storageState: undefined });
      try {
        const page = await context.newPage();
        await presentCertificate(page, { email, redirect: '/chats' });
        await expect(page).toHaveURL(/\/chats/, { timeout: 20000 });

        await page.goto('/settings');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('#profile-email')).toHaveValue(email);
        await page.screenshot({
          path: `screenshots/pki-cert-same-account-${attempt}.png`,
          fullPage: true,
        });
      } finally {
        await context.close();
      }
    }
  });

  // The certificate control on /login is a plain navigation to this route, so
  // GET has to be routed. It used to export only POST, which dead-ended that
  // navigation on 405 and meant certificate sign-in could never complete in a
  // real deployment — this test exists to keep 405 from coming back.
  //
  // What a certificate-less GET answers with changed in v0.23.0: it used to be
  // a 401 carrying a JSON body, which is unreadable to the person who clicked.
  // It now redirects to /login with a reason code. Either way the point holds —
  // the method is routed, and no session is minted.
  test('the cert route answers the GET that /login navigates with', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(`${baseURL}/api/auth/cert?redirect=/chats`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });

    expect(response.status()).not.toBe(405);
    expect(response.status()).toBe(302);

    const location = new URL(response.headers()['location'] ?? '', baseURL);
    expect(location.pathname).toBe('/login');
    // No certificate reached the app, which is a different diagnosis from one
    // that was presented and rejected.
    expect(location.searchParams.get('certError')).toBe('no_certificate');
    expect(response.headers()['set-cookie'] ?? '').not.toContain('session_token');
  });

  test('a certificate that fails chain verification mints no session', async ({ browser }) => {
    const email = uniqueEmail();
    const context = await browser.newContext({ storageState: undefined });

    try {
      const page = await context.newPage();
      await presentCertificate(page, { email, redirect: '/chats', failVerification: true });

      // The mock surfaces the app's refusal instead of redirecting onward.
      await expect(page.getByTestId('mock-pki-rejected')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('mock-pki-rejection-detail')).toContainText(
        /verification failed/i,
      );
      await page.screenshot({ path: 'screenshots/pki-cert-rejected.png', fullPage: true });

      const sessionCookie = (await context.cookies()).find((cookie) =>
        cookie.name.endsWith('session_token'),
      );
      expect(sessionCookie).toBeUndefined();
    } finally {
      await context.close();
    }
  });
});
