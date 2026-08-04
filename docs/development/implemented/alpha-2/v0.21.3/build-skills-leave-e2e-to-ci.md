# Enhancement — Build skills leave e2e to CI and always open a PR

- **Version**: 0.21.3 (bump: **PATCH** — skill documentation only; no product
  code, no schema impact)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`

## Why

### 1. The build skills were running Playwright locally

`/build`, `/bugfix` and `/enhance` each ended with a step that required the
Playwright spec to be *run* and seen to pass — "the test must pass before
proceeding to Step 4", "the test must fail on the unfixed code and pass after
the fix — confirm this before moving on", "the test must pass against the
updated code before moving on".

A local run needs Postgres, Redis, MinIO, a built app and browser binaries,
takes many minutes, and duplicates exactly what `.github/workflows/e2e.yml`
already does on every pull request and push to `main` and `release/**` —
sharded, against a clean stack, with retries and blob reports. The local run
adds nothing that CI does not do better, and it is the slowest, most
environment-sensitive part of every skill run.

Two dedicated skills already exist for the times a local run genuinely helps:
`/e2e` and `/e2e-cc-web`. Nothing is lost by making the local run opt-in
through those.

### 2. Opening the PR read as optional

All three skills ended with a compound bullet — "Commit all changes, push the
branch, then open a pull request…". Buried at the end of a three-part
instruction, the PR step was easy to drop, and stopping at "pushed" is a
plausible-looking finish. It is not: the PR is what starts CI, so if it is
never opened the e2e suite never runs at all — which matters far more now that
the skills deliberately do not run it themselves.

## What changes

Documentation only, in `.claude/commands/`.

### `/build`, `/bugfix`, `/enhance` — write the e2e spec, don't run it

The Playwright step in each skill still requires the spec to be **written**,
with the same placement and naming conventions (`apps/web/e2e/`,
`phase-<slug>.spec.ts` / `fix-<slug>.spec.ts` / `enhance-<slug>.spec.ts`) and
the same coverage expectations. What changes is the verification:

- The step now states plainly that the suite is not to be run, and names
  `.github/workflows/e2e.yml` as where it runs and why (pull requests and
  pushes to `main` and `release/**`, sharded, full stack).
- `/e2e` and `/e2e-cc-web` are named as the opt-in path, used only when the
  user explicitly asks for a local run.
- `/build` adds the review that replaces execution: read the spec for correct
  selectors, correct fixtures, and no dependence on data another spec creates.
  If CI later reports it failing, fix it then.
- `/bugfix`'s fail-then-pass proof moves to where it already belonged — the
  Step 2 regression test, which runs on every `./validate.sh` and is the guard
  that keeps the bug fixed. The e2e spec documents the user-visible
  reproduction; it is not the thing proving the fix.

### `/build`, `/bugfix`, `/enhance` — always open the pull request

Opening the PR becomes its own bullet in each skill's completion step, marked
**always**, with three things attached: no need to ask first, never stop at
"pushed", and the reason (the PR is what starts CI, including the e2e run that
was deliberately skipped locally). The base branch rules are unchanged —
`/build` targets `main`, `/bugfix` and `/enhance` target the base chosen during
their clarifying questions. A final bullet asks for the PR URL to be reported
along with a note that e2e runs there.

## Out of scope

`/e2e` and `/e2e-cc-web` are untouched — they exist precisely to run the suite
locally on request, and remain the way to do that. `/release` and `/doc-review`
never referenced e2e or pull requests and are unchanged.
