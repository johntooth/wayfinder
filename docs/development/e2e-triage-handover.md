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
| `test.skip` guards | 229 | 45 (only 7 actually skip) |
| Non-waiting `isVisible()` probes | 129 | ~116 (in kept specs) |
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

## 2. The one red test — read this before touching it

**`code-quality-hot-paths.spec.ts` › Group C: transactional turn persistence ›
`a committed turn keeps its user message and assistant reply after reload`**

Fails with `Error: assistant reply after reload`. The **user** message survives
the reload; the **assistant** reply does not.

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

### #13 — Remove the 45 skip guards from the kept specs (do this first)

A kept spec may not opt out. 45 guards remain across the 33 specs, though only
7 currently fire. Convert each to a real wait (`expect(...).toBeVisible()` or
`expect.poll(...)`) or build the fixture it wants, then set the CI skip ceiling
to zero and retire `helpers/skip-reasons.ts`.

The 7 live skips, and what they claim:

| Spec:line | Claimed reason |
|---|---|
| `code-quality-hot-paths:34`, `:64` | Seeded session not present |
| `enhance-synthesise-summary:62`, `:94` | Sample run needs staged input documents |
| `chat-confidence:180` | No sessions with document cards found |
| `chat-transparency:37` | No assistant message with persisted aiPayload |
| `fix-session-upload-not-reaching-ai:38` | No attach control on the composer |

**Verify each claim before acting on it.** Five skip messages were disproved
during this work — the `> 5 flows` guard was unsatisfiable by *any* data, and
two "missing fixtures" already existed. A skip message is a claim by whoever
wrote the spec, not a measurement.

### #14 — Verify coverage for the 23 deleted specs that were live

Of 88 deleted specs, 65 were partly or wholly skip-guarded, so little was lost.
**23 were running clean — 51 tests.** They are marked `was running: yes` in the
ledger. Their behaviour belongs at the application/adapter/component layer, but
*this was not verified before deletion*. Confirm coverage exists; write it where
it does not. Recover a spec's text with
`git show 3522b5a~1:apps/web/e2e/<name>.spec.ts`.

### #15 — Rename kept specs to capability names

Most kept specs are still `fix-*`/`enhance-*`/`phase-*`. Merge them into
capability files (`auth-session.spec.ts`, `chat-streaming.spec.ts`,
`file-upload.spec.ts`). Ticket-shaped names are what make people add a file
instead of extending one.

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
