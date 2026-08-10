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

---

## Change Summary — before any code is written

Once the questions are answered, and before creating or editing a single file,
output the change summary below to the chat as regular markdown. Do **not** put
it inside `AskUserQuestion`.

**Headline first.** Open with 3–5 lines of plain prose covering the whole fix,
so the user can approve on the headline alone without reading the sections.

**Then these sections, in this order,** each an `###` heading with bullets under it:

| Section | What it covers |
|---|---|
| Goal | The outcome in the user's terms — the symptom that stops happening, not the implementation |
| Business rules changing | Every rule added, altered or removed, stated with its triggering condition and resulting behaviour — e.g. "when `status = "approved"`, the document locks and further revisions are rejected". For a bug fix, state the rule as it is *meant* to work versus how it behaves today |
| UI / visible behaviour | What the user will see differently — screens, states, copy, empty and error states — each tied to the type, data structure or rule that drives it |
| Data & types | Domain entities, value objects and TypeScript types created or changed, with the shape of each change |
| Files & packages touched | Paths to create, modify or delete, grouped under `domain` / `application` / `adapters` / `apps`, so architecture-boundary violations are visible before any code exists |
| Database & migration impact | Tables and their group prefix, whether a generated migration is required, and the `-- data-impact:` line it will have to carry |
| Tests | The failing regression test that comes first, and the named Playwright e2e spec that will be written but not run |
| Version, branch & PR target | The PATCH bump and resulting version, the `fix/<slug>` branch name, the base branch, and the branch the PR opens against |
| Risks | What could break, and anything destructive or irreversible |
| Out of scope | What is deliberately not being done |

**Omit any section that does not apply** — no heading, no "N/A" placeholder.

**Cap each section at 5 bullets.** If more are warranted, keep the 5 most
significant and close the section with a single `…and N more` bullet.

### Approval gate

Then use `AskUserQuestion` offering exactly three routes:

- **Approve** — start the workflow as summarised.
- **Approve with notes** — start the workflow immediately, applying the notes
  given. Do not re-show the summary and do not ask a second time.
- **Amend** — revise the summary against the feedback and show it again,
  looping until Approve or Approve with notes is chosen.

Do not start the workflow until one of the two approving routes is chosen.

**Persist it — only once approved.** While the summary is still being amended it
stays in chat only, so no unapproved or superseded version ever reaches a doc.
On Approve or Approve with notes, fold in any notes given and then append the
resulting summary to the implementation doc for this change, if one already
exists. If none exists yet, leave it in chat — never create a doc just to house
it — and carry the approved summary into the bug-fix doc when Step 1 generates
it.

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
- **Always open the pull request** via `mcp__github__create_pull_request`, against the base branch from Step 0 (not necessarily `main`) — no need to ask first, and never stop at "pushed". The PR is what starts CI, including the e2e suite that was deliberately not run locally. **Build the PR body from the approved change summary**, corrected to describe what was actually implemented rather than what was planned, and add the implementation detail the summary could not know up front: root cause as verified, the fix applied, the regression test that now guards it, which e2e test covers it, and any deviation from the approved summary called out explicitly.
- Report the PR URL, and note that the e2e suite runs there rather than locally.
