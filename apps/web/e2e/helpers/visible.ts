import type { Locator } from "@playwright/test";

/**
 * Whether the element turns up within `timeout`, rather than whether it happens
 * to be there this instant.
 *
 * `locator.isVisible()` does not wait — Playwright's own types mark its
 * `timeout` option deprecated and ignored. The suite uses
 * `isVisible().catch(() => false)` in 148 skip guards across 55 files, so every
 * one of them is a race against client rendering: the page is still fetching,
 * the probe returns false, and the spec disarms itself reporting missing data
 * for data that arrives a moment later.
 *
 * That is what "Seeded approval-subject flow not in insights" turned out to be
 * — the deep-dive query had simply not resolved — and it is the most likely
 * explanation for the skipped count drifting between runs on identical code.
 *
 * Use this in a skip guard so the skip means "genuinely absent" rather than
 * "not there yet". Keep the timeout short: a skip guard should not be the thing
 * that makes a spec slow.
 */
export async function isVisibleWithin(locator: Locator, timeout = 10_000): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}
