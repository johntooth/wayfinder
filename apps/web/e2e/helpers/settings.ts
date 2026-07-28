import type { Page } from '@playwright/test';

/**
 * Expands a section on /admin/settings.
 *
 * Sections collapse by default so the page reads as an index of what can be
 * configured, which means a spec must open the section holding the card it is
 * about before that card exists in the DOM. Safe to call when the section is
 * already open — it checks aria-expanded first.
 */
export async function openSettingsSection(page: Page, title: string): Promise<void> {
  const header = page.getByRole('button', { name: new RegExp(`^${title}`, 'i') }).first();
  await header.waitFor({ state: 'visible' });
  if ((await header.getAttribute('aria-expanded')) === 'true') return;
  await header.click();
  await page.waitForFunction(
    (sectionTitle) =>
      Array.from(document.querySelectorAll('button[aria-expanded]')).some(
        (button) =>
          button.textContent?.trim().toLowerCase().startsWith(sectionTitle.toLowerCase()) &&
          button.getAttribute('aria-expanded') === 'true',
      ),
    title,
  );
}

/** Opens every section, for specs that sweep the whole page. */
export async function openAllSettingsSections(page: Page): Promise<void> {
  const headers = page.locator('button[aria-expanded]');
  for (let index = 0; index < (await headers.count()); index += 1) {
    const header = headers.nth(index);
    if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
  }
}
