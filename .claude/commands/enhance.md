# /enhance — Enhancement / Revision

Use this skill when the user wants to change or extend something already built.

---

## Required Clarifying Questions

Ask all of these via `AskUserQuestion` before proceeding:

1. What's changing, and why?
2. Which entities or use cases are affected?
3. Are DB changes needed?
4. Is this a MINOR or PATCH bump?
5. Which release does this target? Default is the current release branch (see
   **Release Branching** in `CLAUDE.md`); choose `main` only if it extends
   unreleased work. If the change is really a new feature, stop and route to
   `/new-feature` instead — release branches take no new features.

**After gathering answers:** Output a bulleted plan to the chat covering the likely changes — entities and use cases touched, files to modify, DB migrations needed, API or UI changes, and the version bump target. Do this as regular chat text — do NOT put it inside `AskUserQuestion`. Then use `AskUserQuestion` to ask: "Does this plan look right?" Wait for confirmation before starting the workflow.

---

## Workflow

0. Create the working branch (`enhance/<slug>`) from the base branch chosen in
   question 5. The PR at the end must target that same base branch.
1. Generate an updated phase doc in `docs/development/to-be-implemented/` describing
   what changes and why — do not start coding yet.
2. Run `/doc-review` on the new phase doc before building.
3. Once review passes, follow the `/build` workflow exactly:
   - Decompose into sub-components
   - Write tests before implementation for each sub-component
   - Run `./validate.sh` after each sub-component
4. Write at least one Playwright e2e test that exercises the changed or extended functionality end-to-end — write it, do not run it:
   - Place tests under `apps/web/e2e/` in a file named after the enhancement (e.g. `enhance-<slug>.spec.ts`)
   - Cover the primary user-facing behaviour introduced or modified by this enhancement
   - **Do not run the e2e suite.** CI runs it — `.github/workflows/e2e.yml` fires on every pull request and push to `main` and `release/**`, sharded, against a full stack. A local run needs Postgres, Redis, MinIO and a built app, and only duplicates that. Run `/e2e` or `/e2e-cc-web` only if the user explicitly asks for a local run.
5. On completion:
   - Move phase doc to `implemented/<release line>/v[version]/`. The release line comes from
     the **Release Branching** section of `CLAUDE.md`, not from the version number: the
     `Next release line` value when the base branch is `main`, the current release branch's own
     name otherwise (see `docs/guides/versioning.md`)
   - Write implementation summary (include which e2e test covers the change)
   - Apply the version bump
   - Run `./validate.sh`
   - Commit all changes and push the branch
   - **Always open the pull request** via `mcp__github__create_pull_request`, against the base branch from step 0 (not necessarily `main`) — no need to ask first, and never stop at "pushed". The PR is what starts CI, including the e2e suite that was deliberately not run locally. Include in the PR body: what changed, why, and which e2e test covers the new behaviour.
   - Report the PR URL, and note that the e2e suite runs there rather than locally.
