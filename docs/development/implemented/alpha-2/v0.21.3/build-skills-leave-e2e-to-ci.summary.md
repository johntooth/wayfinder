# Implementation summary — Build skills leave e2e to CI and always open a PR (v0.21.3)

- **Version**: 0.21.3 (**PATCH** — skill documentation only, no product code, no schema impact)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`

Two changes to the three code-writing skills, both about where verification
happens.

## 1. The e2e spec is written, not run

Every skill still writes a Playwright spec under `apps/web/e2e/`, with the same
naming and coverage expectations. None of them run one. The step now names
`.github/workflows/e2e.yml` — which fires on every pull request and push to
`main` and `release/**`, sharded, against a full stack — as where the suite
runs, and `/e2e` / `/e2e-cc-web` as the opt-in path when the user explicitly
asks for a local run.

`/build` gains the review that replaces execution: read the spec for correct
selectors, correct fixtures, and no dependence on data another spec creates.
`/bugfix`'s fail-then-pass requirement moves onto its Step 2 regression test,
which runs under `./validate.sh` — that unit-level guard was always the thing
proving the bug stays fixed; the e2e spec documents the user-visible
reproduction.

## 2. Opening the PR is its own always-do step

Previously the tail of a compound "commit, push, then open a pull request"
bullet, which made stopping at "pushed" look like a finish. It is now a
separate bullet in each skill, marked **always**, stating that there is no need
to ask first and why it matters: the PR is what starts CI, including the e2e
run the skill deliberately skipped. A closing bullet asks for the PR URL to be
reported. Base-branch rules are unchanged — `/build` targets `main`, `/bugfix`
and `/enhance` target the base chosen in their clarifying questions.

## Files changed

| File | Change |
|---|---|
| `.claude/commands/build.md` | Step 3 writes-not-runs + spec review; Step 4 splits out an always-open-a-PR bullet and a report-the-URL bullet |
| `.claude/commands/bugfix.md` | Step 5 writes-not-runs, fail-then-pass proof moves to Step 2; Step 6 splits out the PR and URL bullets |
| `.claude/commands/enhance.md` | Step 4 writes-not-runs; step 5 splits out the PR and URL bullets |
| `VERSION`, `package.json` | 0.21.2 → 0.21.3 |

## Tests

No product code changed, so no test was added. `./validate.sh` passes (20
checks, 0 failures) — it is run here to confirm the version files agree and
nothing else regressed.

## Known limitations

Nothing now runs the e2e suite before a PR exists. A spec with a broken
selector is discovered by CI rather than locally, one round trip later. That is
the intended trade: CI's run is the authoritative one, and the local run it
replaces was slow, environment-dependent, and testing the same thing.

## Out of scope

`/e2e` and `/e2e-cc-web` are untouched — they exist to run the suite locally on
request. `/release` and `/doc-review` never referenced e2e or pull requests.
