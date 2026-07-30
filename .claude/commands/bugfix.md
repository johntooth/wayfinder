# /bugfix — Bug Fix

Use this skill when the user reports something broken or not working as expected.

---

## Required Clarifying Questions

Ask all of these via `AskUserQuestion` before proceeding:

1. What's the symptom?
2. How do you reproduce it?
3. Which page or feature is affected?
4. Severity: blocker / major / minor?
5. Which release does this affect? Default is the current release branch (see
   **Release Branching** in `CLAUDE.md`); choose `main` only if the bug exists
   solely in unreleased work.

**After gathering answers:** Output a bulleted plan to the chat covering the suspected area of the codebase, files likely involved, and the planned diagnostic approach. Do this as regular chat text — do NOT put it inside `AskUserQuestion`. Then use `AskUserQuestion` to ask: "Does this plan look right?" Wait for confirmation before starting the workflow.

---

## Workflow

### Step 0 — Branch from the target release

Create the working branch (`fix/<slug>`) from the base branch chosen in
question 5. The PR at the end must target that same base branch.

### Step 1 — Diagnose first, code second

Generate a bug-fix doc in `docs/development/to-be-implemented/` with:
- Root cause diagnosis (verified, not assumed)
- Reproduction steps
- Fix plan

Do not write implementation code until the diagnosis is confirmed.

### Step 2 — Write a failing test

Before fixing the bug, write a test that reproduces it and currently fails.
This test becomes the regression guard.

### Step 3 — Fix

Implement the minimal change that makes the failing test pass without
breaking existing tests. Do not refactor unrelated code in the same commit.

### Step 4 — Validate

Run `./validate.sh` and fix all failures.

### Step 5 — Playwright e2e test (write it, don't run it)

Write at least one Playwright e2e test that exercises the fixed behaviour through the UI or API surface:
- Place tests under `apps/web/e2e/` in a file named after the bug (e.g. `fix-<slug>.spec.ts`)
- Cover the exact reproduction steps from the bug report, plus any related edge cases the fix touches
- **Do not run the e2e suite.** CI runs it — `.github/workflows/e2e.yml` fires on every pull request and push to `main` and `release/**`, sharded, against a full stack. The fail-then-pass proof lives in the Step 2 regression test, which is the guard that runs on every `./validate.sh`. Run `/e2e` or `/e2e-cc-web` only if the user explicitly asks for a local run.

### Step 6 — On completion

- Move bug-fix doc: `to-be-implemented/<name>.md` → `implemented/<release line>/v[version]/<name>.md`
  The release line comes from the **Release Branching** section of `CLAUDE.md`, not from the
  version number: use the `Next release line` value when your base branch is `main`, and the
  current release branch's own name otherwise (see `docs/guides/versioning.md`)
- Write an implementation summary: root cause, fix applied, regression test added, e2e test added
- Apply a PATCH version bump
- Update `VERSION` and root `package.json` `version`
- Run `./validate.sh` one final time
- Commit all changes and push the branch
- **Always open the pull request** via `mcp__github__create_pull_request`, against the base branch from Step 0 (not necessarily `main`) — no need to ask first, and never stop at "pushed". The PR is what starts CI, including the e2e suite that was deliberately not run locally. Include in the PR body: symptom, root cause, fix summary, and which e2e test covers it.
- Report the PR URL, and note that the e2e suite runs there rather than locally.
