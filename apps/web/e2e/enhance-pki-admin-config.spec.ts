/**
 * enhance-pki-admin-config.spec.ts
 *
 * Covers PKI moving from an environment variable to the admin Authentication
 * card (ADR-042): the three-state row, the server-side guard behind its disabled
 * checkbox, the certificate control on /login, and the wizard gate that now
 * requires a passing test per enabled sign-in method.
 *
 * The env half deliberately did not move. `PKI_TRUSTED_PROXY_IPS` is the trust
 * anchor, so it stays in the environment and the UI reports only whether it is
 * set. That makes this spec run in two shapes:
 *
 *   - the main `chromium` run, booted without the variable — the row is listed
 *     but greyed out, and the server refuses an enable;
 *   - a PKI-mode app (`./restart.sh --with-pki`, or the `e2e-pki` CI job) —
 *     the row is live and the certificate button appears on /login.
 *
 * Each test asserts the branch that matches the app it is pointed at rather
 * than skipping, so the greyed-out state — the one an operator hits first — is
 * covered by the default run.
 */

import { test, expect, type Page } from './helpers/base';
import { openSettingsSection } from './helpers/settings';

const openAuthenticationCard = async (page: Page): Promise<void> => {
  await page.goto('/admin/settings');
  await openSettingsSection(page, 'General');
  // The summary row is the card's own marker, so waiting on it needs no
  // structural locator that a layout change would break.
  await expect(page.getByTestId('auth-summary-pki')).toBeVisible({ timeout: 15000 });
};

const openAuthenticationDialog = async (page: Page): Promise<void> => {
  await openAuthenticationCard(page);
  await page.getByTestId('auth-methods-edit').click();
  await expect(page.getByTestId('auth-pki-row')).toBeVisible({ timeout: 10000 });
};

// A tRPC query driven through the page's request context, so it carries the
// session cookies. Reading the browser's own response body is not an option:
// Chromium discards it once the page settles, and waitForResponse(...).text()
// then fails with "No data found for resource".
const trpcQuery = async (page: Page, procedure: string): Promise<string> => {
  const response = await page.request.get(
    `/api/trpc/${procedure}?input=${encodeURIComponent('{}')}`,
    { failOnStatusCode: false },
  );
  return response.text();
};

// Matches the shape every other spec uses: superjson batch of one.
const trpcMutate = async (
  page: Page,
  procedure: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: string }> => {
  const response = await page.request.post(`/api/trpc/${procedure}?batch=1`, {
    data: { '0': { json: input } },
    failOnStatusCode: false,
  });
  return { status: response.status(), body: await response.text() };
};

const pkiEnvConfigured = async (page: Page): Promise<boolean> =>
  !(await page.getByTestId('auth-pki-checkbox').isDisabled());

test.describe('PKI under the admin Authentication card', () => {
  test('lists the PKI row in both states, never hiding it', async ({ page }) => {
    await openAuthenticationDialog(page);

    const checkbox = page.getByTestId('auth-pki-checkbox');
    await expect(checkbox).toBeVisible();

    if (await pkiEnvConfigured(page)) {
      // Environment satisfied: the switch is the admin's to throw.
      await expect(checkbox).toBeEnabled();
      await expect(page.getByTestId('auth-pki-row')).not.toContainText('PKI_TRUSTED_PROXY_IPS');
    } else {
      // The greyed-out row *is* the documentation: an operator who cannot see
      // the option cannot discover what to ask their infrastructure team for.
      await expect(checkbox).toBeDisabled();
      await expect(page.getByTestId('auth-pki-row')).toContainText('PKI_TRUSTED_PROXY_IPS');
    }

    await page.screenshot({ path: 'screenshots/pki-admin-row.png', fullPage: true });
  });

  test('the certificate route reflects config, not container wiring', async ({ page, baseURL }) => {
    await openAuthenticationDialog(page);
    const envConfigured = await pkiEnvConfigured(page);
    const enabled = await page.getByTestId('auth-pki-checkbox').isChecked();

    const response = await page.request.get(`${baseURL}/api/auth/cert`, { maxRedirects: 0 });

    if (envConfigured && enabled) {
      // Usable: the request reaches the adapter, which rejects a caller with no
      // certificate headers rather than answering that PKI is off.
      expect(response.status()).toBe(401);
      return;
    }
    // Not usable — disabled, or enabled with the environment gate unsatisfied.
    // Either way 403, and never the old container-presence 404.
    expect(response.status()).toBe(403);
  });

  test('refuses to enable PKI server-side when the environment gate is unsatisfied', async ({
    page,
  }) => {
    await openAuthenticationDialog(page);
    test.skip(await pkiEnvConfigured(page), 'environment gate is satisfied — nothing to refuse');

    // A disabled input is a UI affordance, not an authorisation check, so drive
    // the mutation the way a crafted client would.
    const result = await trpcMutate(page, 'settings.setAuthConfig', {
      emailPasswordEnabled: true,
      entraEnabled: false,
      pkiEnabled: true,
      entra: { tenantId: '', clientId: '', clientSecret: null },
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body).toContain('PKI_TRUSTED_PROXY_IPS');
  });

  test('never sends the trusted-proxy addresses to the client', async ({ page }) => {
    // Sign in first: getAuthConfig is admin-scoped.
    await openAuthenticationCard(page);

    const payload = await trpcQuery(page, 'settings.getAuthConfig');

    // envConfigured is a boolean; the addresses behind it never leave the server.
    expect(payload).toContain('envConfigured');
    expect(payload).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
  });
});

test.describe('PKI on the sign-in page', () => {
  test('offers the certificate control only when PKI is usable', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    try {
      const page = await context.newPage();
      await page.goto('/login');

      // enabledAuthMethods is public, so a signed-out context can ask it
      // directly — the same source the page itself renders from.
      const pkiOffered = (await trpcQuery(page, 'settings.enabledAuthMethods')).includes(
        '"pki":true',
      );
      const certificateControl = page.getByTestId('login-certificate');

      if (pkiOffered) {
        await expect(certificateControl).toBeVisible({ timeout: 15000 });
        // A plain navigation, so the mTLS proxy can attach x-ssl-client-* to
        // the browser's own request.
        await expect(certificateControl).toHaveAttribute('href', /\/api\/auth\/cert\?redirect=/);
      } else {
        await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible();
        await expect(certificateControl).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });

  test('sends an unauthenticated visitor to /login in every configuration', async ({ browser }) => {
    // Middleware used to bounce PKI deployments straight to /api/auth/cert, so
    // a login page was never seen and PKI could not coexist with a password.
    const context = await browser.newContext({ storageState: undefined });
    try {
      const page = await context.newPage();
      await page.goto('/admin/settings');

      await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
      // The requested path rides along so the deep link survives the extra click.
      await expect(page).toHaveURL(/redirect=%2Fadmin%2Fsettings/);
    } finally {
      await context.close();
    }
  });
});

test.describe('Wizard gating per enabled sign-in method', () => {
  // Authentication was rendered in the wizard but gated by nothing, so setup
  // could finish with an enabled, broken sign-in method (ADR-042 §5).
  test('renders a requirement per enabled method and blocks on it', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByTestId('rerun-setup').click();

    const wizard = page.getByTestId('setup-wizard');
    await expect(wizard).toBeVisible({ timeout: 15000 });

    await page.getByTestId('wizard-deployment-single').click();
    await page.getByTestId('wizard-continue').click();
    await expect(page.getByTestId('setup-wizard-title')).toContainText('Step 2 of 3');

    // Email + password is on by default, so its requirement is rendered and
    // starts unsatisfied — being enabled is never the same as being tested.
    const emailPasswordRequirement = page.getByTestId('wizard-requirement-auth-email-password');
    await expect(emailPasswordRequirement).toBeVisible({ timeout: 15000 });
    await expect(emailPasswordRequirement).toHaveAttribute('data-satisfied', 'false');
    await expect(page.getByTestId('wizard-continue')).toBeDisabled();

    // A method that is off is neither tested nor gates — the escape hatch when
    // a probe fails for a transient reason.
    await expect(page.getByTestId('wizard-requirement-auth-entra')).toHaveCount(0);
    await expect(page.getByTestId('wizard-requirement-auth-pki')).toHaveCount(0);

    // Explicitly ok or failed, never the "unsupported" state that would count
    // as satisfied without a live answer (phase §9.4).
    await wizard.getByTestId('test-connectivity-auth-email-password').click();
    await expect(page.getByTestId('connectivity-badge-auth-email-password')).toHaveAttribute(
      'data-status',
      /^(ok|failed)$/,
      { timeout: 20000 },
    );

    await page.screenshot({ path: 'screenshots/pki-wizard-auth-requirements.png', fullPage: true });
  });
});
