# Handover — e2e suite triage (PR #241)

**Branch:** `claude/test-consolidation-review-pbz3ru` → base `release/alpha-2`
**HEAD:** `918a4f2` · **Version:** 0.28.3 · **Last CI:** run #695

---

## 1. State of play

The Playwright suite was audited and cut to the specs that genuinely need a
browser. The rule now lives in
[`docs/guides/e2e-test-policy.md`](../guides/e2e-test-policy.md); the per-spec
record of what was removed is in
[`docs/guides/e2e-triage-ledger.md`](../guides/e2e-triage-ledger.md).

| | Before | Now |
|---|---|---|
| Spec files | 121 | **33** |
| Tests reported by CI | 380 | **131** |
| `test.skip` guards | 229 | **18** (down from 45; ~5–9 fire in CI, all capability gates) |
| CI skip ceiling | — | **12** (was 115 — a stale pre-cut figure) |
| Non-waiting `isVisible()` probes | 129 | a handful (converted to waiting assertions) |
| CI shards | 6 | 3 |
| Run duration | — | 7.0m |

**Run #695:** 124 passed · 1 failed · 7 skipped · 2 flaky.

The root cause of the bloat is fixed, not just the symptom: `/build`,
`/enhance` and `/bugfix` used to mandate a new spec per ticket ("write it, do
not run it"), which produced 100 ticket-shaped files written against a UI the
author never observed. All three now gate on the policy and require an explicit
*"no e2e — covered at `<layer>`"* in the summary. `CLAUDE.md` carries the rule
as a non-negotiable.

---

## 2. The "persistence defect" was a locator bug, not a product defect

> **Resolved (PR #244, run #702 on `471fe96`).** The first *complete* run's app
> log gives the observation four rounds of static reading could not: the failure
> is a Playwright **strict-mode violation** —
> `getByText('Recorded — this turn is committed to the thread.') resolved to 2
> elements` — on the assistant-reply assertion. The reply is not absent; it is
> **present twice**. A turn that completes its step renders the reply as more
> than one bubble (the feed splits at finish_step boundaries — `message-feed.tsx`,
> and `chat.spec.ts` already documents this), so `getByText` matches every
> segment and the unscoped locator fails strict mode. The error text
> ("assistant reply after reload … toBeVisible failed") reads exactly like the
> row being missing, which is how it was diagnosed as a persistence defect.
>
> The assertion was only added in this branch — before it, the reload re-checked
> only the user message — so it had never passed, and its one failure mode is
> this strict-mode violation, not a lost row. Fix: `.first()` on both
> `ASSISTANT_REPLY` assertions (before and after reload). The reload half still
> genuinely proves persistence: the reply text is in the DOM after a document
> reload, so the row committed.
>
> Earlier runs (`#690`–`#695`) reported this test as the sole red; `#700`/`#701`
> looked green but were **cancelled** partial runs (successive pushes tripped
> `cancel-in-progress`) that never finished the code-quality shard, so their
> "green" was noise. `#702` is the first shard-complete run, and it is what
> surfaced the real cause. CI will confirm the `.first()` fix; if a *genuine*
> absence ever appears (reply text not in the DOM at all), that is a different
> failure and would need the row from a docker-capable stack (this sandbox has
> no Postgres). The diagnostic history below is kept as the map for that day.

**`code-quality-hot-paths.spec.ts` › Group C: transactional turn persistence ›
`a committed turn keeps its user message and assistant reply after reload`**

Historically reported `Error: assistant reply after reload` — read as: the
**user** message survives the reload, the **assistant** reply did not. The
observation above reframes that as a strict-mode match on a segmented reply.

Seen in runs #690, #692, #694, #695. Run #693 failed differently (45s timeout) —
that variant is explained by the `networkidle` wait, now removed.

### Four hypotheses, all dead

Do not spend time re-deriving these.

1. **The stub streams different text than it resolves.**
   No. `ScriptedLanguageModel.growingPartials` slices
   `response.slice(0, end + STREAM_CHUNK_SIZE)`; the final iteration clamps to
   the full string, and the `object` promise resolves the same `response`.

2. **The write error is swallowed.**
   No, not on this path. `persistAssistantTurn`'s Result error **is** checked
   and thrown at `execute-turn.ts:347`. The `.catch(() => null)` at
   `turn-helpers.ts:213` is real but sits on the cross-check *gap-follow-up*
   path, which this test never exercises.

3. **The reload races the commit.**
   No. The confidence score streams at `execute-turn.ts:170`, two LLM
   round-trips before `persistAssistantTurn` at `:333`, so gating the reload on
   it *was* wrong — but fixing it (waiting for the stream body to close, commit
   `918a4f2`) changed nothing. The handler had already finished.

4. **The feed hides messages from a completed node after the session advances.**
   No. `listBySession(sessionId)` takes only a session id — there is no node
   filter at the port.

### What the code says

`run-turn.ts:122` `persistAssistantTurn` → `commitAssistantTurn` creates the
assistant message **inside** the transaction (`:159`) alongside the session
advance, and propagates any error (`:167`), which the caller throws on. A failed
write should surface as a thrown error, not a missing row. That is precisely
what makes the observed behaviour strange.

### Next step

**Stop reading code and get the row.** Three theories built from static reading,
all dead. Run the stack locally, drive that single turn, and query
`core_session_messages` for the session. One observation settles whether the row
exists, and everything downstream depends on that answer.

Corroborating signal worth carrying in: `chat-transparency.spec.ts:37` skips
with *"No assistant message with AI reasoning available (no persisted
aiPayload)"* — an independent test also failing to find persisted assistant
payloads. It may be seed data rather than the turn path, but if the two share a
cause, one fix clears a failure and a skip.

**This is a product-defect investigation, not test work.** It is separate from
the triage and should not hold the triage hostage.

---

## 3. Remaining tasks

### #13 — Remove the skip guards from the kept specs — DONE (45 → 18)

Closed on branch `claude/e2e-test-coverage-review-a0bjnz`. Dead-code guards
(unreachable after `requireSeedFixtures()` throws) were deleted; UI-probe guards
(composer, attach control, register link, seeded session card) became
`await expect(x).toBeVisible()` so a missing control fails instead of skipping;
`helpers/skip-reasons.ts` and `helpers/visible.ts` were retired. The CI skip
ceiling was corrected from a meaningless **115** (a stale figure from the
390-test pre-cut suite) to **12**. Per-guard rationale is in
[`../guides/e2e-triage-ledger.md`](../guides/e2e-triage-ledger.md).

The 18 that remain are genuine capability gates the CI environment does not
satisfy (`extraction_flows` off → the synthesise specs; real embeddings →
`fix-session-upload-not-reaching-ai`, which was also un-broken from a hardcoded
non-existent session path; PKI/Entra mock reachability), plus **two deferred to
the live-stack pass below** because converting them would create reds that can't
be verified by reading:

| Spec | Claimed reason | Why deferred |
|---|---|---|
| `chat-confidence` (document card) | No document card on the seeded session | Depends on whether the seed completes a document-generation step — a live run settles it |
| `chat-transparency` (reasoning modal) | No assistant message with persisted `aiPayload` | Same missing-`aiPayload` signal as the persistence defect in §2 — likely one fix clears both |

A few secondary UI-probe fallbacks were also left (`accessibility` "no seeded
flow", the `#auth-entra` card fallbacks inside the Entra gates); they were not
firing in CI and their selectors are fragile, so they wait on a live run too.

**Verify each claim before acting on it.** Skip messages disproved during this
work include the `> 5 flows` guard (unsatisfiable by *any* data) and two
"missing fixtures" that already existed. A skip message is a claim by whoever
wrote the spec, not a measurement.

### #14 — Verify coverage for the 23 deleted specs that were live — DONE

Each of the 23 was recovered from `3522b5a~1` and traced to the layer that owns
its behaviour. **22 of 23 are covered one layer down** (confidence scale, signature
slots, audit hash chain, MCP register/validate/disable, usage tiers, SKILL.md
validation, connectivity probes, batch-size validation — the mapping is in the
ledger). The one real gap — `phase-scheduler-resume`'s tick shared-secret guard —
now has a route handler test at
`apps/web/src/app/api/internal/scheduler/tick/route.test.ts`. The only other
un-migrated item, `phase-container-distribution`'s "version is never `unknown`",
is a `?? "unknown"` one-liner with no unit logic (a smoke concern).

### #15 — Rename kept specs to capability names — PARTIAL

The structural cause is fixed: `/build`, `/enhance` and `/bugfix` now tell authors
to extend the existing capability spec, not add a file. The remaining work —
merging same-capability files (the five chat specs into one streaming spec, the
file-upload specs into one) and dropping the `fix-*`/`enhance-*`/`phase-*` prefixes
— is cosmetic and deliberately deferred: merging spec files without a runnable
suite risks the exact silently-broken test this effort removes, so it should ride
a pass with the stack up (`/e2e-cc-web` or the PR's CI).

**Folded in when `release/alpha-2` merged (branch-rules feature, v0.28.0).** The
base's `enhance-branch-rules.spec.ts` arrived carrying the pattern this branch
removes — a ticket-style name and four `test.skip(!flowId, …)` guards on a fixture
the spec itself needs (`forkFlowId`). Renamed to `branch-rules.spec.ts` and the
four guards replaced with `requireSeedFixtures()`, so a missing fork flow fails
the run instead of skipping green. CI confirmed the fork flow seeds (those four
tests ran and passed in run #706 before the change), so the conversion loses no
coverage. The two v0.28.0 feature docs were updated to the new filename.

---

## 4. Traps in this repo — learned the hard way

- **`locator.isVisible()` does not wait.** Its `timeout` option is deprecated
  and ignored. Wrapped in `test.skip(!await x.isVisible(), …)` it turns "still
  rendering" into "does not apply", and CI goes green.
- **`networkidle` cannot fire on a session page.** An open SSE connection means
  the network is never idle; the wait can only burn the test timeout.
- **Never push while a CI run is in progress.** `concurrency: cancel-in-progress`
  kills it. Run #691 was lost this way.
- **Trust named reason counts, not net totals.** Run #686 changed no test code
  and still moved passed +4 / skipped −3. Treat any swing under ±4 as noise.
- **CI artifacts cannot be downloaded from this environment** — the agent proxy
  403s `blob.core.windows.net`. The PR comment is the source of truth; it lists
  flaky tests with their first error and every skip by file and line.
- **The stop-hook can author commits.** `a5243a4` was not written by hand. Check
  `git log` authorship before assuming a diff is yours.
- **One reproduction is not proof.** The persistence defect was called
  "confirmed" on two runs and the third undercut it.

---

## 5. Suggested order

1. **#13** — closes the last route by which the suite can lie about being green,
   and it is now bounded to 33 files.
2. **Persistence defect** — needs a local stack run, not another CI round trip.
3. **#14** — the one place this triage could have quietly lost something.
4. **#15** — cosmetic but preventive; do it before the next feature lands.
