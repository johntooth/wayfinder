# Implementation Summary — `validate.sh` aborts on macOS at check 16

**Version**: 0.19.2  (bump: PATCH)
**Phase doc**: [`validate-empty-array-bash32.md`](./validate-empty-array-bash32.md)
**PRD**:       n/a — developer tooling defect
**ADR(s)**:    n/a

## Root cause

`validate.sh` runs under `set -uo pipefail`. Check 16 declared
`SIZE_LEGACY_ALLOWLIST=()` and expanded it as `"${SIZE_LEGACY_ALLOWLIST[@]}"`.
On **bash 3.2** — the version macOS ships — expanding an empty array under
`set -u` is treated as an unset variable and aborts the shell. bash 4.4+
expands it to nothing instead, so CI (`ubuntu-latest`, bash 5) never saw it.

The blast radius was wider than the reported symptom: the abort happened at
check 16 of 19, so checks 16, 17, 18 and 19 had **never run on any macOS
machine**. The script exited `1` with no summary despite every check that ran
reporting `PASS`.

## What was built

- **Check 20 — bash 3.2 safe array expansion.** A static check that scans every
  `*.sh` file for arrays declared empty (`NAME=()`) and later expanded as
  `"${NAME[@]}"` without the `[@]+` guard, and fails listing file and line.
- **Fixed all three unguarded sites** to `${NAME[@]+"${NAME[@]}"}`.

`FAILED_CHECKS` was included even though it could not crash today — the
`exit 0` at the end of the summary short-circuits before it is reached when
there are no failures. It is the same defect one edit away from firing, and
leaving it would have forced check 20 to carry an exception.

## Files modified

- `validate.sh` — check 20 added; `SIZE_LEGACY_ALLOWLIST` (1 site) and
  `FAILED_CHECKS` (2 sites) switched to the guarded expansion
- `VERSION`, `package.json` — 0.19.1 → 0.19.2

## Migrations run

None.

## Regression test

Check 20 in `validate.sh`, verified in both directions:

- **Fails on the unfixed tree** — flagged exactly the three real sites and
  none of the safe ones (`HEALTH_FILES`, `PORTS_TO_KILL`, `FRAMEWORK_PKGS` are
  statically populated and correctly ignored).
- **Passes on the fixed tree.**
- **Catches reintroduction** — a new script declaring `MY_LIST=()` and
  expanding it unguarded was flagged by file and line.

A *runtime* test was deliberately rejected: CI runs bash 5, where the buggy
code executes fine, so a runtime test would stay green with the bug present
and would not protect the branch. A static check fails on every CI build
regardless of the runner's bash version.

## Known limitations

- Check 20 detects the *declared-empty* pattern (`NAME=()` … `"${NAME[@]}"`).
  An array that is populated conditionally and can still be empty at its
  expansion point is not detected. No such case exists in the repo today; all
  other arrays are statically populated at declaration.
- Detection is line-based: a line carrying both a guarded and an unguarded
  expansion of the same array would be treated as guarded. No such line exists.

## No Playwright e2e test

`/bugfix` step 5 asks for an e2e test through the UI or API surface.
`validate.sh` is a developer shell script reachable from neither — it is not
part of the running application. Check 20 is the regression guard and it runs
on every CI build.

## Validation

- `./validate.sh` on macOS (bash 3.2.57): **exit 0 — Passed: 20, Failed: 0** (2026-07-28).
  Checks 16–19 report for the first time on macOS.
