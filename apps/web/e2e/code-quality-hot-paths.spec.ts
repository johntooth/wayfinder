/**
 * code-quality-hot-paths.spec.ts
 *
 * The Code-Quality Hot-Paths phase, whole. It shipped as five spec files named
 * group-a, -c, -d, -e and -f (there was never a -b) because the phase doc
 * grouped its checklist that way — a fact about how the work was written down,
 * not about the app. Each shard's original preamble is kept above its tests.
 */

import { test, expect } from './helpers/base';
import { aiScriptDiagnostics, clearAiScript, completeTurn, scriptAiFor } from './helpers/ai-script';
import { requireSeedFixtures } from './helpers/seed';
import { openAllSettingsSections } from './helpers/settings';
import { NO_COMPOSER } from './helpers/skip-reasons';
import { isVisibleWithin } from './helpers/visible';

/**
 * phase-code-quality-hot-paths-group-a.spec.ts
 *
 * Covers Group A (hot-path data access) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * `session.list` no longer loads every session's full message history to derive
 * its list row — it aggregates the latest assistant message and the best
 * per-step confidence SQL-side in a fixed number of queries
 * (ISessionMessageRepository.summariseForSessionList). This spec proves the list
 * view still renders those derived fields exactly, so the refactor is
 * behaviour-neutral end to end.
 *
 * The seeded "E2E SEED Session" (apps/web/src/lib/e2e-fixtures.ts) belongs to a
 * two-step flow; its newest assistant message is the onboarding-plan reply.
 */
test.describe('Code quality Group A: session-list hot-path aggregation', () => {
  test('the chats list shows the latest assistant message and step progress', async ({
    page,
    consoleLogs,
  }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    const seededCard = page
      .locator('a[href^="/chats/"]')
      .filter({ hasText: 'E2E SEED Session' })
      .first();
    if (!(await seededCard.isVisible().catch(() => false))) {
      test.skip(true, 'Seeded session not present — seed fixtures to enable this test');
      return;
    }

    // lastMessage is the newest *assistant* message (SQL DISTINCT ON … seq DESC),
    // not the last user turn.
    await expect(seededCard).toContainText(/onboarding plan for Jane Smith/i);
    await expect(seededCard).not.toContainText('Please draft the onboarding plan document.');

    // stepInfo comes from the per-step best-confidence aggregation: a two-step
    // flow renders a "Step n/2" indicator.
    await expect(seededCard).toContainText(/step\s+\d+\s*\/\s*2/i);

    // The refactor must not throw while deriving the list rows.
    const errors = consoleLogs.filter((entry) => entry.type === 'error');
    expect(errors, `JS errors on /chats:\n${errors.map((entry) => entry.text).join('\n')}`).toHaveLength(0);
  });

  test('clicking a session card follows through from the list to the chat', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    const seededCard = page
      .locator('a[href^="/chats/"]')
      .filter({ hasText: 'E2E SEED Session' })
      .first();
    if (!(await seededCard.isVisible().catch(() => false))) {
      test.skip(true, 'Seeded session not present — seed fixtures to enable this test');
      return;
    }

    await seededCard.click();
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]+$/, { timeout: 10_000 });
  });
});

/**
 * phase-code-quality-hot-paths-group-c.spec.ts
 *
 * Covers Group C (unit-of-work port) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * RunTurn.persistAssistantTurn now writes the assistant message and the session
 * advance/complete/await through a single IUnitOfWork transaction
 * (DrizzleUnitOfWork over db.transaction), so the two writes commit or roll back
 * together. Rollback semantics are unit-tested against the adapter; here we prove
 * the committed turn is durable end to end through the real transaction path: a
 * sent turn's user message and its assistant reply both persist across a reload.
 */
test.describe('Code quality Group C: transactional turn persistence', () => {
  const ASSISTANT_REPLY = 'Recorded — this turn is committed to the thread.';

  test.afterEach(async ({ page }, testInfo) => {
    const { sessionId } = requireSeedFixtures();
    if (testInfo.status !== testInfo.expectedStatus) {
      // Attached before the script is cleared. A purpose the turn never asks
      // for yields an empty reply and no error anywhere, which is how "chat"
      // vs "chat-turn" survived review once — requestedPurposes is the only
      // thing that tells those apart from the outside.
      await testInfo.attach('ai-script-purposes.json', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(await aiScriptDiagnostics(page, sessionId), null, 2)),
      });
    }
    await clearAiScript(page, sessionId);
  });

  test('a committed turn keeps its user message and assistant reply after reload', async ({
    page,
  }) => {
    const { sessionId } = requireSeedFixtures();

    // Persistence is the whole assertion, so the turn has to reach the server.
    // The browser-level mock in helpers/base.ts intercepts
    // /api/chat/[sessionId]/stream — the route that executes the turn and
    // commits it — so under that mock nothing is ever written and a reload
    // could only ever show an empty thread. scriptAiFor unroutes it and drives
    // the server-side model instead.
    await scriptAiFor(page, sessionId, [completeTurn(ASSISTANT_REPLY)]);

    await page.goto(`/chats/${sessionId}`);

    const input = page
      .locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]')
      .first();
    if (!(await isVisibleWithin(input))) {
      test.skip(true, NO_COMPOSER);
      return;
    }

    const userMessage = `Group C durability check ${Date.now()}`;
    await input.fill(userMessage);
    await input.press('Enter');

    // A real turn now: the server call, then the transactional persist.
    //
    // Each assertion names itself, because "expect(locator).toBeVisible()
    // failed" in the run summary cannot say which of the four fired, and the
    // four mean entirely different things: the send not working, the stub not
    // driving the turn, or the commit not surviving a reload.
    await expect(page.getByText(userMessage), 'user message before reload').toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(ASSISTANT_REPLY),
      'scripted assistant reply before reload — if only this fails, the turn ran but the stub did not supply the reply (check the attached purposes)',
    ).toBeVisible({ timeout: 30_000 });

    // Reload: only committed rows come back. Both halves of the turn must
    // return, proving the transaction committed rather than leaving a
    // half-applied (or rolled-back) turn. Asserting the reply as well as the
    // message is the point of the test's name, and it was never checked —
    // the old middle step waited on selectors that match nothing in
    // message-feed.tsx, and the reload only ever re-checked the user message.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(userMessage), 'user message after reload').toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(ASSISTANT_REPLY), 'assistant reply after reload').toBeVisible({
      timeout: 10_000,
    });
  });
});

/**
 * phase-code-quality-hot-paths-group-d.spec.ts
 *
 * Covers Group D (frontend decomposition) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * Item 9: the 2,183-line admin settings page was split into one file per
 * settings section under components/settings/, with the shared connectivity
 * hook/badge/test extracted alongside. The decomposition is meant to be
 * byte-for-byte behaviour, so the risk it introduces is a *dropped* card. This
 * spec loads /admin/settings and asserts every extracted section's card title
 * still renders (each CardTitle is an <h3>, rendered unconditionally — unlike
 * the connectivity test buttons, some of which are gated on the section being
 * configured), plus the AI section anchor and header "Test all" button, with no
 * console errors.
 */
// One title per extracted card file — each an <h3> rendered unconditionally.
const CARD_TITLES = [
  'General',
  'User Registration',
  'Authentication',
  'Global AI Instructions',
  'AI Provider',
  'Document Generation',
  'n8n Integration',
  'RAG Embeddings',
  'Object Storage (S3 / MinIO)',
  'Session Uploads',
  'Email',
  'Notifications',
  'HR Directory Data',
  'Approver Directory (Microsoft Entra)',
];

test.describe('Code quality Group D: settings page decomposition', () => {
  test('every extracted settings section still renders', async ({ page, consoleLogs }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await openAllSettingsSections(page);

    // AI section anchor (rendered by the page shell between the extracted cards).
    await expect(page.getByTestId('settings-section-ai')).toBeVisible();
    // Header control that fans out to every connectivity card.
    await expect(page.getByTestId('test-all-connectivity')).toBeVisible();

    // Each extracted card contributes its own <h3> title; all must be present,
    // proving no card was dropped in the split. Substring match tolerates any
    // inline status badge some card headers render alongside the title.
    for (const title of CARD_TITLES) {
      await expect(
        page.getByRole('heading', { level: 3, name: title }).first(),
      ).toBeVisible();
    }

    const errors = consoleLogs.filter((entry) => entry.type === 'error');
    expect(
      errors,
      `JS errors on /admin/settings:\n${errors.map((entry) => entry.text).join('\n')}`,
    ).toHaveLength(0);
  });
});

/**
 * phase-code-quality-hot-paths-group-e.spec.ts
 *
 * Covers Group E (boundary tightening) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * Item 17: the chat stream POST body is now Zod-validated (streamTurnRequestSchema)
 * instead of trusted via a bare cast, so a malformed body is a clean 400 rather
 * than a failure deep in the turn. This drives the authenticated endpoint with a
 * bad body and asserts the 400. (Items 15 and 18 — the getSessionToken dedupe and
 * ADR numbering notes — have no separate runtime surface.)
 */
test.describe('Code quality Group E: stream body validation', () => {
  test('a malformed stream body is rejected with 400', async ({ page }) => {
    const sessionId = requireSeedFixtures().sessionId;
    if (!sessionId) {
      test.skip(true, 'Seed fixtures unavailable — seed to enable this test');
      return;
    }

    // Authenticated (the base fixture carries the admin cookie) but the body's
    // `messages` is the wrong type, so schema validation must reject it.
    const response = await page.request.post(`/api/chat/${sessionId}/stream`, {
      data: { messages: 'not-an-array' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(400);
  });
});

/**
 * phase-code-quality-hot-paths-group-f.spec.ts
 *
 * Covers Group F (in-process rate limiting) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * The auth POST endpoint is fronted by a per-instance token-bucket IRateLimiter
 * keyed by IP. Bursting past the configured capacity must return HTTP 429 with a
 * Retry-After header — proving the real limiter is wired into the route (the
 * bucket maths itself is unit-tested).
 */
test.describe('Code quality Group F: in-process rate limiting', () => {
  test('bursting the auth endpoint eventually returns 429', async ({ page }) => {
    // Fire a tight burst of sign-in attempts (bad credentials — we only care about
    // the limiter, which runs before the auth handler). One IP, one bucket: past
    // the configured burst the limiter must start refusing with 429.
    const attempts = 60;
    let sawTooManyRequests = false;
    let retryAfter: string | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await page.request.post('/api/auth/sign-in/email', {
        data: { email: `burst-${attempt}@example.com`, password: 'wrong-password' },
        failOnStatusCode: false,
      });
      if (response.status() === 429) {
        sawTooManyRequests = true;
        retryAfter = response.headers()['retry-after'] ?? null;
        break;
      }
    }

    expect(sawTooManyRequests, 'expected a 429 within the burst').toBe(true);
    // A throttled response tells the client when to retry.
    expect(retryAfter).not.toBeNull();
  });
});
