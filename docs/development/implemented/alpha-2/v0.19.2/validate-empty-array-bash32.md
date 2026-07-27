# Bug Fix — `validate.sh` aborts on macOS at check 16

- **Base branch**: `release/alpha-2` (defect exists in the shipped alpha)
- **Severity**: Blocker for the documented contributor workflow
- **Affected surface**: `validate.sh` (developer tooling — no UI or API surface)

## Symptom

On macOS, `./validate.sh` aborts partway through check 16 with:

```
./validate.sh: line 289: SIZE_LEGACY_ALLOWLIST[@]: unbound variable
```

The script exits `1` even when every check that ran reported `PASS`. Checks 16
and 17 never report, and the summary block never prints.

## Reproduction

1. On macOS (any version — the system `bash` is 3.2), from the repo root:
   ```bash
   ./validate.sh
   ```
2. Observe checks 1–15 print `PASS`, then the run dies inside check 16 with the
   error above and exit code `1`.

Does **not** reproduce on CI: `ci.yml` runs `ubuntu-latest`, whose bash is 5.x.

## Root cause (verified)

`validate.sh` runs under `set -uo pipefail` (line 6). Check 16 declares an
empty array and then expands it in a `for`:

```bash
SIZE_LEGACY_ALLOWLIST=()                        # line 273 — declared empty
...
for legacy_file in "${SIZE_LEGACY_ALLOWLIST[@]}"; do   # line 280 — unguarded
```

In **bash 3.2**, expanding an empty array as `"${arr[@]}"` while `set -u` is
active is treated as expanding an unset variable, and the shell aborts. bash
4.4+ changed this: an empty array expands to nothing and the script continues.
macOS ships bash 3.2.57 (the last GPLv2 release), so every macOS contributor
hits this and no CI run ever will.

Confirmed directly against the system shell:

```
$ /bin/bash -c 'set -u; a=(); for x in "${a[@]}"; do echo "$x"; done'
/bin/bash: a[@]: unbound variable        # exit 127

$ /bin/bash -c 'set -u; a=(); for x in ${a[@]+"${a[@]}"}; do echo "$x"; done'
                                          # exit 0, no output
```

The `${arr[@]+"${arr[@]}"}` form expands to nothing when the array is empty and
to the correctly-quoted elements otherwise — verified to keep an element
containing a space (`"two three"`) as a single word.

### Scope of the defect class

Every `"${array[@]}"` expansion in the repo's shell scripts was audited. Only
arrays that can be *empty at the point of expansion* are affected:

| Location | Array | Status |
|---|---|---|
| `validate.sh:280` | `SIZE_LEGACY_ALLOWLIST` | **Broken** — declared empty at 273, never appended to |
| `validate.sh:358`, `validate.sh:375` | `FAILED_CHECKS` | **Latent** — declared empty at 18; safe today only because `exit 0` at 353 short-circuits when there are no failures. One edit away from the same crash |
| `validate.sh:143` | `HEALTH_FILES` | Safe — statically populated at 137 |
| `restart.sh:46` | `PORTS_TO_KILL` | Safe — always ≥ 2 elements |
| `scripts/init-project.sh:190` | `FRAMEWORK_PKGS` | Safe — statically populated at 37 |
| `scripts/update-framework.sh:66,138` | `FRAMEWORK_PKGS` | Safe — statically populated at 43 |

## Fix plan

1. **Regression guard first.** Add a `validate.sh` check that scans every
   tracked `*.sh` file for arrays declared empty (`NAME=()`) that are later
   expanded unguarded as `"${NAME[@]}"`, and fails listing them. This is the
   only guard that works: a *runtime* test would pass on CI's bash 5 even with
   the bug present, so it would not protect the branch where it matters.
   Confirm the new check fails against the current file before fixing anything.

2. **Fix both sites** — `SIZE_LEGACY_ALLOWLIST` and both `FAILED_CHECKS`
   expansions — using `${NAME[@]+"${NAME[@]}"}`. `FAILED_CHECKS` is in scope
   because it is the same defect, in the same file, and leaving it would force
   the new check to carry an exception.

3. **Verify** `./validate.sh` runs to completion on macOS and exits `0`.

## Why no Playwright test

Step 5 of `/bugfix` asks for an e2e test through the UI or API surface.
`validate.sh` is a developer shell script with neither — it is not reachable
from the running application. The `validate.sh` check added in step 1 is the
regression test, and it runs on every CI build.
