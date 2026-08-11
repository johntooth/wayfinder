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

## File structure (where to add to the Wayfinder repo)

```
wayfinder/                         ← your existing repo root
  tests/
    e2e/                           ← all of this lives here
      playwright.config.ts
      package.json
      auth.setup.ts
      smoke.spec.ts
      flows.spec.ts
      chat.spec.ts
      helpers/
        base.ts                    ← extended fixture: console capture + AI mock
      fixtures/
        ai-responses.ts            ← canned AI response payloads
      playwright/
        .auth/                     ← gitignored; session state saved here
      playwright-report/           ← gitignored; HTML report output
      screenshots/                 ← gitignored; per-test screenshots
      test-results/                ← gitignored; traces and videos
  .github/
    workflows/
      e2e.yml                      ← CI workflow
```

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

## Skips, and the two reasons a spec is parked

A skipped spec is green in every report while asserting nothing, so the suite can
stop testing something without any run turning red. CI therefore fails when the
skipped count crosses a ceiling (`MAX_SKIPPED` in `.github/workflows/e2e.yml`).
Raising it is a legitimate fix; it just has to be a decision rather than a side
effect.

The count is not deterministic — consecutive runs of the same commit measured 98
and 101 of 390, because some gates depend on runtime state rather than on a fixed
property of the environment. The ceiling therefore carries headroom: it is sized
to catch the seed breaking or a batch of specs disarming themselves, which move
the count by tens, not to police single-test drift.

The run summary groups every skip by reason, and the `skipped-tests` artifact
lists them per test. Use those rather than reading the gates out of the specs —
a spec's stated reason is a hypothesis until it runs, and several have turned out
to be wrong.

### What the 96 skips are actually made of (run #679)

Measured, not inferred. 52 distinct reasons, and the shape is not what the
per-spec comments claimed:

| Reason | Count | What it really is |
|---|---:|---|
| Seeded approval-subject flow not in insights | 9 | the seed **does** create this flow |
| Needs a server-side AI stub | 8 | now unblocked — see below |
| No pending approvals for this user | 7 | the seed **does** raise approvals |
| Seeded approval-first flow did not render | 4 | the seed **does** create this flow |
| No seeded approval awaiting this user | 3 | ditto |
| No seeded chat available — chats list is empty | 3 | the seed **does** create a session |
| Search button not present — requires > 5 flows | 3 | **not** a seed gap — see below |

That last row was wrong, and it is left here because the wrong call is the
instructive part: it was recorded as the one honest fixture gap in the table,
on the strength of the skip message alone. The seed creates **nine** flows, and
#687 proved it — all four `> 5 flows` skips cleared once the guards stopped
racing, leaving one honest `More than 5 flows present — search button already
visible` from the inverse test. Nothing was seeded to achieve that.

One of those four could never have passed on any data: it counted flow cards
and skipped on `count <= 5`, but `FLOW_CARD_THRESHOLD` slices the list to five,
so more than five flows still renders exactly five cards. The guard rejected the
only value it could ever observe. A skip message is a claim by the spec author,
not a measurement — check it against the component before believing it.

### The cause: `isVisible()` does not wait

Putting the diagnosis into the skip message settled it in one run:

```
9 × Seeded approval-subject flow not in insights: the deep-dive query had not resolved yet
```

Not a seed gap, not consumed state, not the card threshold — the specs were
looking before the data arrived. `waitForLoadState('networkidle')` returns while
`_content.tsx` still renders nothing but "Loading…", and the guard below it
probes instantly.

**`locator.isVisible()` returns immediately.** Playwright's own types mark its
`timeout` option deprecated and ignored. The suite has **148 of these probes
across 55 files**, nearly all in skip guards:

```typescript
test.skip(!(await thing.isVisible().catch(() => false)), "no thing");   // a race
test.skip(!(await isVisibleWithin(thing)), "no thing");                 // a question
```

So a large share of the ~97 skips are specs that disarmed themselves over data
that turned up a moment later. It also explains the drift — skipped 96 → 97 → 99
and flaky 7 → 8 → 11 across four runs of near-identical code. The insights page
loses the race every time because its deep-dive query is reliably slow; faster
pages win sometimes.

`helpers/visible.ts` provides `isVisibleWithin()`. Adopt it in skip guards as
you touch them, **one spec at a time, checking the count after each**. Do not
sweep all 148: the same instinct applied to `networkidle` turned two shards red,
because waits that look wasteful had become load-bearing for the specs
downstream of them.

### What converting one cluster actually bought

Two clusters have been converted so far, each measured on its own run:

| Run | Change | Passed | Skipped | Flaky |
|---|---|---:|---:|---:|
| #683 | baseline | 303 | 97 | 7 |
| #684 | insights + governance guards | 313 | 87 | 7 |
| #685 | 7 approvals-list guards | 311 | 84 | 12 |
| #686 | **no spec changes at all** | 315 | 81 | 11 |
| #687 | flow-selector guards + skip-message grouping | 320 | 78 | 9 |

**Read reason counts, not the total.** #686 changed only the report generator
and this file, yet passed moved +4 and skipped moved −3 — the same −3 that had
just been credited to #685's guard conversion. The net total has a run-to-run
noise floor of ±3–4 tests, so it cannot settle a change of that size on its own.
What is trustworthy is a *named reason* going to zero and staying there:
`No pending approvals for this user in the seeded stack` was 7 in #684, 0 in
#685, and 0 in #686. That is a fix. A three-point drop in the total is weather.

#684 recovered ten tests and the nine insights skips vanished. #685 removed the
`No pending approvals for this user in the seeded stack` reason entirely — the
guard is fixed — but netted only **−3**, because behind that guard sit *more*
instant probes:

```typescript
test.skip(!(await isVisibleWithin(row)), "no pending approvals");        // fixed
const edit = row.getByRole("button", { name: "Edit before deciding" });
test.skip(!(await edit.isVisible().catch(() => false)), "no document");  // still a race
```

Unblocking a guard just moves the spec to the next one. Expect a cluster to pay
out over two passes, not one.

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

### The parked specs are gated on environment variables, not on data

Ten spec families skip on `!process.env.SOMETHING_PATH` while their message
blames the seed:

```typescript
test.skip(!process.env.E2E_FLOWS_DASHBOARD_PATH,
  "Needs seeded fork-flow dashboard data, which seedE2EFixtures does not create yet");
```

The condition is an unset variable. The reason is a claim about fixtures. They
are not the same statement, and for at least four skips the claim is false:

| Parked as | Actually |
|---|---|
| fork-flow dashboard data | `seedForkFlow` builds the flow **and two sessions each capturing `amount`** ($1,500 / $2,750) — exactly what the spec's own preamble describes |
| editable-document session | the seeded session carries `onboarding-plan.docx` (`documentStatus: "complete"`) with `name` / `organisation` step outputs, which is what the dialog edits |
| knowledge-base session and chunks | genuinely absent — `kb_document_chunks` appears only in the cleanup path |
| quota-blocked session | genuinely absent — nothing seeds a cap or a blocked session |

So verify before building. Two of these fixtures already existed and only needed
the spec pointed at `requireSeedFixtures()`; building them again would have been
a day spent duplicating the seed.

The eight specs waiting on the server-side AI stub are gated the same way, each
on its own `*_SESSION_PATH`, which is what "each needs a purpose-built session"
concretely means.

### What the skips were hiding (run #688)

The composer cluster recovered twelve tests and broke two, which is the first
time un-skipping produced a failure. Both were worth having:

`chat.spec.ts › sending a message shows AI response` waited on
`[data-testid="message"], [class*="message"], [class*="chat-message"],
[role="log"] > *`. **None of those exist.** `message-feed.tsx` has no
`data-testid`, no `[role="log"]`, and its Tailwind classes contain no
"message" — the only hooks were `data-participant-message` and
`data-message-time`. The test reported "AI response did not appear" for a reply
that was on screen the whole time.

`multi-turn conversation works`, in the same file, waited on the same dead
selectors — and then `.catch(() => {})` the timeout. It burned 8s per turn and
passed regardless. That is the failure mode this whole exercise is named for: a
green test asserting nothing.

`code-quality-hot-paths › a committed turn keeps its user message and assistant
reply after reload` was worse than rotted. It is a *persistence* test, and the
browser mock intercepts `/api/chat/[sessionId]/stream` — the route that
executes the turn and commits it. Under that mock the server never runs, nothing
is written, and a reload could only ever show an empty thread. It also never
asserted the assistant reply its own name promises. It now drives the
server-side stub (`scriptAiFor`) and checks both halves survive the reload.

The feed now carries `data-chat-message="user" | "assistant"`, matching the
`data-*` convention the rest of the app already uses for E2E hooks. Prefer it
over class or role guesses; the typing indicator deliberately does not carry it,
so waiting for an assistant bubble cannot match the dots.

**A skipping test is not a neutral cost.** These three rotted silently for as
long as the guard kept them disarmed, and two of them would have kept reporting
success.

### Approvals specs act on `.first()` — they can consume each other

Now that the approvals-list guards actually pass, specs that previously never
reached their bodies do. Several of them **act destructively on whichever
approval happens to be first**:

- `fix-approval-change-request-regeneration.spec.ts` — rejects it
- `enhance-document-edit-history.spec.ts` — edits it
- `enhance-approval-flow-fixes.spec.ts` — decides on it

All three take `page.locator("[data-approval-id]").first()` against one seeded
stack, with `workers: 1` inside a shard. Whichever runs first changes what the
others find.

This is a structural hazard readable in the source. It is **not** what the flaky
tests are, and that is now measured rather than assumed: #686 named all eleven,
and not one is an approvals spec. They are `auth-username-password`,
`enhance-flow-editor-dedup`, `enhance-pki-admin-config`,
`enhance-repeating-group-editing`, `enhance-synthesis-flow-ui-fixes`,
`enhance-synthesise-enhancements`, `fix-entra-account-linking`,
`fix-sticky-link-navigation`, `phase-email-notifications`,
`phase-extraction-flows-author-sample` and `scaling` — failing on
`expect(page).toHaveURL` (×5), `apiRequestContext` timeouts (×3),
`page.waitForURL`, `locator.click` and one 45s test timeout. Navigation and API
timing, a different class of problem from anything in this section.

Fixture consumption has now been offered three times as an explanation and has
never once been supported by evidence. Treat the `.first()` overlap above as a
latent hazard in the code, not as a diagnosis of anything observed.

If you do scope one of these specs to its own approval, scope it via
`requireSeedFixtures()` rather than `.first()`.

### Two explanations that were wrong

Recorded so nobody re-derives them:

- *The flow is past the fifth card in `FlowSelector`.* The threshold is real
  (`FLOW_CARD_THRESHOLD`, overflow behind "Search for more"), but routing the
  specs through the search box left the count at exactly 9.
- *An earlier spec in the same worker consumed the shared approval.* Offered
  twice as the explanation for the **insights** skips, with no evidence; a
  consumption race would make that count vary, and it never did. Note this was
  wrong about *those* skips, not about the mechanism — see the `.first()`
  hazard above, which became reachable only once the guards stopped racing.

The lesson both times: a mechanism consistent with the code is a hypothesis.
Put the diagnosis in the skip message — the run summary groups it — and let a
run answer. An attachment will not do: `test-results/` uploads only
`if: failure()`, and a skip is not a failure.

**Never skip because a fixture is missing.** The `chromium` project declares
`seed` as a dependency, so a spec body only runs once the seed has passed. Use
`requireSeedFixtures()` from `helpers/seed.ts` — it throws, naming the fixture,
so a broken seed fails loudly instead of quietly disarming a spec file. That
failure mode hid the whole of `enhance-chat-approval-withdraw-inline.spec.ts`
for several releases.

Skip only for a capability the environment genuinely lacks: no object storage
(`E2E_OBJECT_STORAGE`), PKI off, real-AI-only paths.

### Parked specs

Twelve specs are gated on an `E2E_*_PATH` variable CI never sets, so they run
only via the `/e2e` skill against a hand-prepared stack. They are parked for two
different reasons, and the fixes are not the same piece of work:

**1. Seed gap** — the spec needs rows `seedE2EFixtures` does not create. Fixable
by extending `apps/web/src/lib/e2e-fixtures.ts`.

| Spec | Needs |
|---|---|
| `enhance-fork-field-consolidation` | fork-branch step outputs on the seeded fork flow |
| `phase-cost-usage-governance` (blocked-session test) | a session for a user over an enabled cap |
| `phase-knowledge-base-curation` | indexed knowledge-base chunks |
| `phase-manual-document-editing` | a session whose document card is on an editable step |

**1b. Not a seed gap after all — spec drift.** Two of the specs above turned out
not to need any data. Their pages render every card unconditionally, with empty
states; what actually blocked them was assertions written against an older UI.
Both were half-recovered: the render test now runs, the CRUD test still does not.

| Spec | What was really wrong |
|---|---|
| `phase-cost-usage-governance` (dashboard) | asserted a "Spend caps" heading; the card is titled "Usage limits" |
| `enhance-usage-limits-admin-ui` (render) | same stale heading |
| both CRUD tests | `SpendCapsCard` defaults `scope` to `"everyone"`, so `#cap-user` is not in the DOM until the scope selector is switched — a step these specs predate |

The lesson generalises: a parked spec's stated reason is a hypothesis until it
runs. Check the page before extending the seed for it.

**2. Server-side AI** — not a seed gap at all. The mock in `helpers/base.ts` is
a *browser* route intercept (`page.route`), but the app calls the AI provider
from the Next.js server, where that intercept cannot reach. `/api/chat/[id]/stream`
is mocked wholesale, which replaces the very server logic these specs assert on.

There is now a stub for this — see **Scripting the server-side AI** below. These
specs are being moved onto it one at a time; each move turns a spec that
asserted "nothing bad is visible" into one that names the confidence, verdict or
failure it expects.

Moved: `fix-confidence-threshold-scale`.

Still parked: `enhance-pre-generation-evaluation`, `fix-cross-check-chat-feedback`,
`fix-document-generation-gate-livelock`, `fix-document-generation-step-flow`,
`fix-fork-advance-threshold`, `fix-pre-generation-gate-phantom-doc-badge`.

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
