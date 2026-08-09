/**
 * enhance-synthesis-flow-ui-fixes.spec.ts
 *
 * Covers v0.21.0 — the batch of UI enhancements and fixes across chat, flows,
 * synthesise, the sidebar, the help menu and admin configuration.
 *
 * Verifies the user-facing behaviour each change introduced:
 *   - Sidebar: Settings is no longer a nav link; the user details block in the
 *     bottom left reaches /settings instead. (v0.23.3 put that behind the
 *     block's account menu rather than making the block itself the link.)
 *   - Help menu: an "About" item opens the About modal, which carries the app
 *     version and the configured links; "Contact developers" is gone.
 *   - Admin configuration: sections start collapsed and expand on click, and
 *     the General section carries the About card.
 *   - Flows: /flows has the same fixed page header /chats does.
 *   - Synthesise: the new-synthesis modal body is padded (inside a DialogBody).
 */

import { test, expect } from './helpers/base';
import { openAccountMenu } from './helpers/account-menu';
import { openSettingsSection } from './helpers/settings';

test.describe('Sidebar: settings moved to the user details block', () => {
  test('the sidebar no longer carries a Settings nav link', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  });

  test('the user details block reaches the settings page', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    // v0.23.3 turned the block from a direct link into a menu trigger, so
    // Settings is now one level down rather than the block's own destination.
    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});

test.describe('Help menu: About replaces contact developers', () => {
  test('the help menu offers About and no longer offers Contact developers', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Help' }).click();

    await expect(page.getByRole('menuitem', { name: /^about$/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /contact developers/i })).toHaveCount(0);
  });

  test('About opens a modal carrying the app version and the default issue link', async ({
    page,
  }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: /^about$/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/about wayfinder/i)).toBeVisible();
    await expect(dialog.getByText(/^version /i)).toBeVisible();
    // Ships by default so a fresh install always has a route to report a bug.
    await expect(dialog.getByRole('link', { name: /report an issue/i })).toBeVisible();
  });
});

test.describe('Admin configuration: collapsed sections and the About card', () => {
  test('sections start collapsed and expand when clicked', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    const general = page.getByRole('button', { name: /^General/ }).first();
    await expect(general).toHaveAttribute('aria-expanded', 'false');

    await general.click();

    await expect(general).toHaveAttribute('aria-expanded', 'true');
  });

  test('the General section carries the About link configuration', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await openSettingsSection(page, 'General');

    await expect(page.getByRole('heading', { name: 'About' })).toBeVisible();
    await expect(page.getByTestId('about-link-add')).toBeVisible();
    // The default "Report an issue" entry is editable rather than hard-coded.
    await expect(page.getByTestId('about-link-row').first()).toBeVisible();
  });

  test('adding a link appends an editable row', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await openSettingsSection(page, 'General');

    const before = await page.getByTestId('about-link-row').count();
    await page.getByTestId('about-link-add').click();

    await expect(page.getByTestId('about-link-row')).toHaveCount(before + 1);
  });
});

test.describe('Flows: page header', () => {
  test('/flows carries a fixed page header like /chats', async ({ page }) => {
    await page.goto('/flows');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Flows', level: 1 })).toBeVisible();
  });
});

test.describe('Synthesise: new-synthesis modal', () => {
  test('the modal body is padded rather than flush to the dialog edge', async ({ page }) => {
    await page.goto('/synthesise');
    await page.waitForLoadState('networkidle');

    const newButton = page.getByRole('button', { name: /new synthesis/i }).first();
    test.skip(
      !(await newButton.isVisible().catch(() => false)),
      'Synthesise Information is not enabled for this deployment',
    );
    await newButton.click();

    const nameInput = page.locator('#synthesis-name');
    await expect(nameInput).toBeVisible();

    // DialogBody supplies px-[22px]; without it the field sat flush to the edge.
    const paddingLeft = await nameInput.evaluate((element) => {
      const body = element.closest('div')?.parentElement;
      return body ? window.getComputedStyle(body).paddingLeft : '0px';
    });
    expect(parseFloat(paddingLeft)).toBeGreaterThan(0);
  });
});
