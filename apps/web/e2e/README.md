# Wayfinder E2E Tests

End-to-end tests using Playwright. Lives **inside the Wayfinder repo** at `apps/web/e2e/`.

---

## How it works

### AI mock vs real — the core toggle

Every push runs tests with **mocked AI**, at two levels:

- **In the browser** — the test fixture intercepts calls to `api.anthropic.com`,
  `api.openai.com`, and Wayfinder's internal `/api/chat/[id]/stream`.
- **On the server** — `TEST_AUTH_BYPASS=true` swaps the AI provider for
  `ScriptedLanguageModel` (see *Scripting the server-side AI*), so calls the
  Next.js server makes never leave the box either.

No API key needed, no cost, fast. The browser layer alone used not to be enough:
CI sets `ANTHROPIC_API_KEY` on every run, and any server-side call went straight
to the real provider.

When you want a **real integration test** (i.e. actual AI responses flowing through),
trigger the workflow manually from the GitHub Actions UI and select `use_real_ai: true`.
You'll need `ANTHROPIC_API_KEY` set as a GitHub secret for that run.

```
Every push   →  USE_REAL_AI=false  →  mock responses, ~2min run, no cost
Manual run   →  USE_REAL_AI=true   →  real Anthropic API, slower, uses credits
```

### What gets captured

Every test captures:
- **Screenshot** of the full page at the end of each meaningful step
- **Console logs** (all levels) attached to the test in the HTML report
- **Console errors** surfaced prominently — if there's a JS error, the test fails
- **Failed network requests** (4xx/5xx) checked in smoke tests
- **Video** of the browser session (retained only on failure)
- **Trace** (DOM snapshots + network timeline, retained only on failure)

---

## File structure

```
wayfinder/
  apps/web/e2e/                    ← the whole suite lives here
    playwright.config.ts           ← CI config: setup → seed → chromium, plus pki
    playwright.local.config.ts     ← local runs against an already-booted stack
    auth.setup.ts                  ← signs in once, saves storage state
    seed.setup.ts                  ← creates the shared fixtures (see e2e-fixtures.ts)
    cleanup.teardown.ts            ← tears the seeded data down
    *.spec.ts                      ← 33 specs, one per capability
    helpers/
      base.ts                      ← extended fixture: console capture + AI mock
      seed.ts                      ← requireSeedFixtures(): throws if the seed failed
      ai-script.ts                 ← scriptAiFor(): drives a real server-side turn
      account-menu.ts  chat-mock.ts  flow-builder.ts  settings.ts
    playwright/.auth/              ← gitignored; session state
    playwright-report/             ← gitignored; HTML report
    test-results/                  ← gitignored; traces and videos
  .github/workflows/e2e.yml        ← CI workflow (3 shards + a separate pki job)
```

The seed fixtures themselves are defined in
`apps/web/src/lib/e2e-fixtures.ts`, not here — they run inside the app so they
go through the same repositories the product uses.

---

## One-time setup

### 1. Add to your `.env`

```
TEST_AUTH_BYPASS=true
TEST_ADMIN_EMAIL=admin@example.com   # match your ADMIN_SEED_EMAIL
```

Restart the app after adding these.

### 2. Add to `.gitignore`

```gitignore
apps/web/e2e/playwright-report/
apps/web/e2e/test-results/
apps/web/e2e/screenshots/
apps/web/e2e/playwright/.auth/
apps/web/e2e/node_modules/
```

### 3. Install Playwright

```bash
cd apps/web/e2e
npm install
npx playwright install --with-deps chromium
```

---

## Running tests locally

Start Wayfinder first (`docker compose up` or your local dev setup), then:

```bash
cd apps/web/e2e

npm test                    # all tests, mocked AI
npm run test:smoke          # just smoke checks
npm run test:flows          # just flows tests
npm run test:chat           # just chat tests
npm run test:real-ai        # all tests, real Anthropic API (needs ANTHROPIC_API_KEY)
```

### View the HTML report

```bash
npm run report
# Opens at http://localhost:9323
# Shows every test with: pass/fail, screenshot, console logs, errors
```

---

## Running away from your desk (GitHub Actions)

### Automatic (every push)
The workflow runs automatically. Go to **Actions → E2E Tests** to see results.
Download the `playwright-report-N` artifact and open `index.html` to see the full report.

### Manual with real AI
1. Go to **Actions → E2E Tests (Playwright)**
2. Click **Run workflow**
3. Set `use_real_ai` to `true`
4. Click **Run workflow**

### Required GitHub secrets
Go to **Settings → Secrets and variables → Actions**:

| Secret | Required for |
|---|---|
| `ANTHROPIC_API_KEY` | Real AI runs only |
| `BETTER_AUTH_SECRET` | All runs (or it uses a default test value) |

---

## What belongs in this suite

**Read [`docs/guides/e2e-test-policy.md`](../../../docs/guides/e2e-test-policy.md)
before adding a spec.** A Playwright test is written only when the behaviour
falls into one of six groups that genuinely need a browser: auth session
lifecycle, streaming into the DOM, file upload/download, navigation state across
a page load, accessibility, and smoke. Everything else is tested at the layer
that owns the logic.

This suite was cut from 121 spec files to 33 in PR #241. What was removed and
why is recorded per spec in
[`docs/guides/e2e-triage-ledger.md`](../../../docs/guides/e2e-triage-ledger.md).

### The failure mode that made the triage necessary

`/build`, `/enhance` and `/bugfix` each required a new spec per ticket, written
without running it. A spec written against an unobserved UI cannot be trusted to
pass, so it was wrapped in `isVisible()` guards — and:

**`locator.isVisible()` does not wait.** Its `timeout` option is deprecated and
ignored. It samples the DOM once and returns immediately, so against a page that
is merely still rendering it returns `false`. Wrapped in
`test.skip(!await x.isVisible(), ...)`, that turns "the page had not finished
loading" into "this test does not apply", and CI reports green.

At its peak the suite carried 229 skip guards, 129 of these probes, and 27 specs
gated on environment variables nobody set.

Use `expect(...).toBeVisible()` or `expect.poll(...)` — both retry. If a spec
needs a fixture that does not exist, build the fixture; do not guard the test.

**Never skip because a fixture is missing.** The `chromium` project declares
`seed` as a dependency, so a spec body only runs once the seed has passed. Use
`requireSeedFixtures()` from `helpers/seed.ts` — it throws, naming the fixture,
so a broken seed fails loudly instead of quietly disarming a spec file.

Skip only for a capability the environment genuinely lacks: no object storage
(`E2E_OBJECT_STORAGE`), PKI off, real-AI-only paths.

### Reading the CI report

The PR comment names every flaky test with its first error, and lists every skip
by file and line in a collapsed section. Trust **named reason counts**, not the
net totals: run #686 changed no test code and still moved passed by +4 and
skipped by −3. Treat any swing under ±4 in the totals as noise.

### Specs that act on `.first()` can consume each other

`workers: 1` and `fullyParallel: false` mean specs share one seeded stack within
a shard. A spec that takes `page.locator("[data-approval-id]").first()` and acts
destructively on it changes what later specs find. Scope to a fixture you own.

---

### The purpose map (read this before scripting a turn)

`ScriptedLanguageModel` matches on `purpose`, and a script whose purpose the
code never asks for yields an empty result with **no error anywhere**. Verified
call sites:

| Purpose | Call site | What it drives |
|---|---|---|
| `chat-turn` | `apps/web/.../stream/execute-turn.ts:151` | the conversational turn (reply + confidence) |
| `chat-branch-choice` | `apps/web/.../stream/execute-turn.ts:199` | picking a fork branch |
| `chat-gap-followup` | `apps/web/.../stream/turn-helpers.ts:183` | the follow-up that asks for an outstanding gap |
| `chat-title` | `apps/web/.../stream/session-title.ts:50` | naming the session |
| `chat` | `packages/application/.../document/generate-document.ts:111` | document generation, including the pre-generation cross-check |

Note the last row. A document-generating step needs **both** `chat-turn` and
`chat` scripted; scripting only the turn leaves the doc-gen call unscripted and
the step silently produces nothing. `"chat"` was once put in a script where the
call site used `"chat-turn"` and the symptom was an empty reply with no failure
— check `requestedPurposes` from `/api/test/ai-script` first when a scripted
spec produces nothing.

## Scripting the server-side AI

`helpers/ai-script.ts` registers canned responses the *server* will return for a
session, via the test-only `/api/test/ai-script` route. Use it whenever the
behaviour under test is a judgement the model makes — a confidence, a branch
choice, a document-generation verdict — rather than something the browser
renders.

```typescript
import { scriptAiFor, completeTurn, incompleteTurn, clearAiScript } from './helpers/ai-script';

await scriptAiFor(page, sessionId, [
  incompleteTurn('What is the budget envelope?', 20),
  completeTurn('That covers the step.', 95),
]);
// … drive the chat …
await clearAiScript(page, sessionId);
```

- Entries are consumed in order and **the last one repeats**, so an incidental
  extra call cannot fall back to a default that contradicts the script.
- `object` is merged over a schema-shaped default, so set only the fields under
  test.
- `purpose` scopes an entry to one kind of call (`"chat"`, `"branching"`,
  `"chat-title"`, …). Omit it to match any.
- `failWith` fails the call, for the error paths.
- `scriptAiFor` lifts the browser-level stream intercept itself, so using the
  script and taking the server path cannot come apart.

The stub is `ScriptedLanguageModel` in `packages/adapters`, swapped for the real
adapter in `apps/web/src/lib/scripted-llm.ts` when `TEST_AUTH_BYPASS=true` and
`USE_REAL_AI` is not `true`. It sits *inside* the quota/usage/tracing decorator
chain, so governance stays under test rather than being bypassed along with the
provider. Clear a session's script in `afterEach` — the stub is process-wide and
outlives the test that set it.

## Known: `networkidle` cannot fire on a session page

The chat view holds one EventSource open for its lifetime — it replaced the 2s
typing poll and the 3s session poll (see `_content.tsx`). That connection never
closes, so a `/chats/<id>` page never reaches `networkidle`, and the 26
`waitForLoadState('networkidle')` calls that follow a session navigation can
only ever burn their full timeout.

Measured against a seeded session on a live stack:

```
networkidle        never fired (20s timeout)
composer visible   52ms
```

**Do not "fix" this with a blanket find-and-replace.** That was tried and
reverted. Swapping all 26 for a `[data-composer-stack]` wait made the eight
worst-affected files go from 13 failures to 4 locally — and turned two CI shards
red, because specs downstream of those waits had come to rely on the accidental
30-second settle for their own state to arrive. Removing it exposed races that
had been papered over.

The 30 `/chats` **list**-page `networkidle` waits are fine; that page holds no
stream and settles normally.

Doing this properly means giving each affected spec a deterministic wait for the
thing it actually needs, one spec at a time, verified against CI's sharding —
not one sweep. The 30s-per-call cost is worth reclaiming, but only that way.

## Adding new tests

Import from `./helpers/base` instead of `@playwright/test` to get console capture and AI mocking automatically:

```typescript
import { test, expect } from './helpers/base';

test('my new test', async ({ page, consoleLogs }) => {
  await page.goto('/some-page');
  await page.screenshot({ path: 'screenshots/my-new-test.png', fullPage: true });

  // This automatically fails the test if there are JS errors
  const errors = consoleLogs.filter(l => l.type === 'error');
  expect(errors).toHaveLength(0);
});
```

## Adding new mock AI responses

Edit `fixtures/ai-responses.ts` to add responses for specific workflow steps:

```typescript
export const MOCK_RESPONSES = {
  // ... existing responses ...
  myNewStep: "Here's what I say at this step of the workflow.",
};
```

Then update `pickResponse()` in `helpers/base.ts` to use it based on message content.
