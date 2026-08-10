# /build — Build: New Phase or Feature

Use this skill when documentation review has passed and the user confirms,
or when the user explicitly asks to implement a specific phase or feature.

**Pre-flight:** Confirm the phase doc in `docs/development/to-be-implemented/`
exists and has passed `/doc-review`. Read the PRD, ADR(s), and phase doc in
full before writing a single line of code. Create the working branch
(`feature/<slug>`) from `main` — new features land on the next release line,
never on a `release/*` branch (see **Release Branching** in `CLAUDE.md`).

---

## Workflow

### Step 0 — Change summary

After the pre-flight reading and before writing a single line of code, output
the change summary below to the chat as regular markdown. Do **not** put it
inside `AskUserQuestion`.

**Headline first.** Open with 3–5 lines of plain prose covering the whole
phase, so the user can approve on the headline alone without reading the
sections.

**Then these sections, in this order,** each an `###` heading with bullets under it:

| Section | What it covers |
|---|---|
| Goal | The outcome in the user's terms — what the phase delivers, not the implementation |
| Business rules changing | Every rule added, altered or removed, stated with its triggering condition and resulting behaviour — e.g. "when `status = "approved"`, the document locks and further revisions are rejected" |
| UI / visible behaviour | What the user will see differently — screens, states, copy, empty and error states — each tied to the type, data structure or rule that drives it |
| Data & types | Domain entities, value objects and TypeScript types created or changed, with the shape of each change |
| Files & packages touched | Paths to create, modify or delete, grouped under `domain` / `application` / `adapters` / `apps`, so architecture-boundary violations are visible before any code exists |
| Database & migration impact | Tables and their group prefix, whether a generated migration is required, and the `-- data-impact:` line it will have to carry |
| Tests | The test files written before each implementation file, and the named Playwright e2e spec that will be written but not run |
| Version, branch & PR target | MINOR or PATCH and the resulting version, the `feature/<slug>` branch name, and `main` as both base and PR target |
| Risks | What could break, and anything destructive or irreversible |
| Out of scope | What is deliberately not being done in this phase |

**Omit any section that does not apply** — no heading, no "N/A" placeholder.

**Cap each section at 5 bullets.** If more are warranted, keep the 5 most
significant and close the section with a single `…and N more` bullet.

### Step 1 — Decompose

Break the phase into sub-components of no more than 3–4 files each.
List them directly beneath the Step 0 summary, so the user sees the change and
the order it will be built in together.

**Approval gate.** Then use `AskUserQuestion` offering exactly three routes,
covering the Step 0 summary and this decomposition together:

- **Approve** — start building as summarised.
- **Approve with notes** — start building immediately, applying the notes
  given. Do not re-show the summary and do not ask a second time.
- **Amend** — revise the summary and decomposition against the feedback and
  show them again, looping until Approve or Approve with notes is chosen.

Do not start Step 2 until one of the two approving routes is chosen.

**Persist it — only once approved.** While the summary and decomposition are
still being amended they stay in chat only, so no unapproved or superseded
version ever reaches the phase doc. On Approve or Approve with notes, fold in
any notes given and then append the resulting summary to the phase doc in
`docs/development/to-be-implemented/` — the pre-flight guarantees one exists.
Never create a doc just to house the summary.

### Step 2 — For each sub-component (strictly in order)

**A. Write tests first**
- Create `*.test.ts` before the implementation file
- Cover: happy path, error path (`DomainError`), key edge cases
- Use in-memory fakes for ports — never mock what you own
- Tests must read as plain English: setup → execute → verify
- Prefer a few duplicated setup lines over a shared abstraction that obscures intent

**B. Implement**
- Make the tests pass with the minimum code required
- Follow all architecture and code writing rules from `CLAUDE.md`
- Before calling any third-party API (Vercel AI SDK, LangGraph, Better Auth, Drizzle):
  verify the method signature in `node_modules/<package>/` source — do not trust training data

**C. Validate**
- Run `./validate.sh`
- Fix every failure before moving to the next sub-component
- Do not proceed until `validate.sh` exits 0

### Step 3 — Playwright e2e test (write it, don't run it)

Once all sub-components pass validation, write at least one Playwright e2e test that exercises the completed feature end-to-end through the UI or API surface:
- Place tests under `apps/web/e2e/` in a file named after the phase (e.g. `phase-<slug>.spec.ts`)
- Cover the primary happy path and at least one error path visible to the user
- **Do not run the e2e suite.** CI runs it — `.github/workflows/e2e.yml` fires on every pull request and push to `main` and `release/**`, sharded, against a full stack. A local run needs Postgres, Redis, MinIO and a built app, and only duplicates that. Run `/e2e` or `/e2e-cc-web` only if the user explicitly asks for a local run.
- Review the spec by reading it, not by executing it: correct selectors, correct fixtures, no reliance on data another spec creates. If CI later reports it failing, fix it then.

### Step 4 — On completion

- Move phase doc: `to-be-implemented/<name>.md` → `implemented/<release line>/v[version]/<name>.md`
  The release line comes from the **Release Branching** section of `CLAUDE.md`, not from the
  version number: use the `Next release line` value when your base branch is `main`, and the
  current release branch's own name otherwise (see `docs/guides/versioning.md`)
- Write an implementation summary in the same `implemented/<release line>/v[version]/` folder covering:
  what was built, files created/modified, migrations run, known limitations, e2e tests added
- Update `VERSION` file and root `package.json` `version` (they must match)
- Run `./validate.sh` one final time — fix all failures before declaring done
- State the version bump applied (MINOR / PATCH — MAJOR is reserved for the first stable release)
- Commit all changes and push the branch
- **Always open the pull request** via `mcp__github__create_pull_request`, against `main` — no need to ask first, and never stop at "pushed". The PR is what starts CI, including the e2e suite that was deliberately not run locally. New features never target a `release/*` branch (see **Release Branching** in `CLAUDE.md`). **Build the PR body from the approved Step 0 change summary**, corrected to describe what was actually implemented rather than what was planned, and add the implementation detail the summary could not know up front: files created and modified, migrations generated, the version bump applied, which e2e tests cover the new functionality, known limitations, and any deviation from the approved summary called out explicitly.
- Report the PR URL, and note that the e2e suite runs there rather than locally.
