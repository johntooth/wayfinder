import type { Page } from '@playwright/test';

/**
 * Opens the sidebar footer's account menu.
 *
 * v0.23.3 moved Settings, Usage and Sign out off the rail and behind the user
 * chip, so a spec that wants any of them has to open the menu first — before
 * that, none of those items exist in the DOM. Safe to call when the menu is
 * already open: it checks aria-expanded first.
 */
export async function openAccountMenu(page: Page): Promise<void> {
  const chip = page.getByRole('button', { name: /account menu/i });
  await chip.waitFor({ state: 'visible' });
  if ((await chip.getAttribute('aria-expanded')) === 'true') return;
  await chip.click();
  await page.getByRole('menu').waitFor({ state: 'visible' });
}
