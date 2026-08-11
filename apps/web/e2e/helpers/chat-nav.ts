/**
 * helpers/chat-nav.ts
 *
 * Opening a chat session, without waiting for something that cannot happen.
 *
 * The chat page holds one EventSource open for the life of the view — it
 * replaced the 2s typing poll and the 3s session poll (see _content.tsx). That
 * connection never closes, so the page never reaches `networkidle`, and
 * `waitForLoadState('networkidle')` after a /chats/ navigation can only ever
 * burn its full timeout.
 *
 * Measured against a seeded session on a live stack:
 *
 *   networkidle          never fired (20s timeout)
 *   composer visible     52ms
 *
 * Fifty-six call sites did exactly that, which is most of a 46-minute suite
 * spent waiting for a condition the page is architecturally incapable of
 * reaching. Whether a run passed came down to whether the spec had a later
 * assertion generous enough to cover the lost 30 seconds.
 *
 * `data-composer-stack` is rendered by the loaded chat view and by nothing
 * else — not the loading state, not the error state — so its presence is the
 * honest "this session is on screen" signal, for read-only and approval-gated
 * sessions alike.
 */

import { type Page } from './base';

/** Rendered by the loaded chat view only; holds the composer or the approval gate. */
export const CHAT_READY = '[data-composer-stack]';

/** Navigate to a session and wait until its chat view is on screen. */
export async function gotoChat(
  page: Page,
  sessionId: string,
  options: { query?: string } = {},
): Promise<void> {
  const query = options.query ? `?${options.query.replace(/^\?/, '')}` : '';
  await page.goto(`/chats/${sessionId}${query}`);
  await waitForChatReady(page);
}

/** Wait for an already-navigated chat page to finish loading. */
export async function waitForChatReady(page: Page): Promise<void> {
  await page.locator(CHAT_READY).first().waitFor({ state: 'attached', timeout: 30_000 });
}
