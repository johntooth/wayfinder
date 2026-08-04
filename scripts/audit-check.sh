#!/usr/bin/env bash
# audit-check.sh — dependency audit gate, shared by validate.sh and CI.
#
# Fails on any high or critical advisory except those explicitly allowlisted
# below. Both validate.sh and .github/workflows/ci.yml call this so the two can
# never drift apart on what counts as a blocking advisory.
#
# Exit codes: 0 = clean (or every finding allowlisted, or endpoint unavailable),
#             1 = at least one blocking advisory.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Allowlist ─────────────────────────────────────────────────────────────────
#
# GitHub advisory IDs that do NOT fail the build. Every entry must state what it
# is, why it cannot be fixed, and the condition that removes it again. Keep this
# list as short as it can possibly be — an entry here is a security gate held
# open, and anything not listed still fails.
#
# Empty, and that is the goal: every finding is fixed by a version, not waived.
# GHSA-mh99-v99m-4gvg (brace-expansion) sat here until brace-expansion backported
# the fix to the 1.x line — the exact condition its REMOVE WHEN named. The
# `brace-expansion@1/@2/@5` pins in the root package.json now carry all three
# majors past both that advisory and GHSA-rgw5-rvv9-x895, so the waiver went with
# it. Staying on the 1.x line matters: brace-expansion@5 exports an object rather
# than the callable minimatch@3 requires, so forcing the major breaks the linter.
ALLOWED_ADVISORIES=()

# ── Run the audit ─────────────────────────────────────────────────────────────
AUDIT_JSON=$(pnpm audit --audit-level=high --json 2>&1)
AUDIT_STATUS=$?

if [ "$AUDIT_STATUS" -eq 0 ]; then
  echo "No high or critical advisories."
  exit 0
fi

# npm retired the legacy audit API that `pnpm audit` calls, so the endpoint can
# answer 410 for everyone. A registry-side outage is not a code failure.
if echo "$AUDIT_JSON" | grep -qiE 'ERR_PNPM_AUDIT_BAD_RESPONSE|being retired|audit endpoint|410|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN'; then
  echo "SKIP — pnpm audit endpoint unavailable; dependency audit not run."
  exit 0
fi

# ── Filter the findings against the allowlist ─────────────────────────────────
# The `-` default keeps `set -u` from tripping over an empty allowlist array.
ALLOWED_CSV=$(IFS=,; echo "${ALLOWED_ADVISORIES[*]-}")

REPORT=$(ALLOWED="$ALLOWED_CSV" node -e '
const allowed = new Set((process.env.ALLOWED || "").split(",").filter(Boolean));

let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    // Not JSON and not a known outage string — surface it rather than pass.
    console.log("UNPARSEABLE");
    process.exit(0);
  }

  const advisories = Object.values(parsed.advisories || {});
  const blocking = [];
  const waived = [];
  for (const advisory of advisories) {
    if (!["high", "critical"].includes(advisory.severity)) continue;
    const id = advisory.github_advisory_id || String(advisory.id);
    (allowed.has(id) ? waived : blocking).push(
      `${advisory.severity} — ${advisory.module_name} — ${id} — ${advisory.title}`,
    );
  }

  for (const line of waived) console.log("WAIVED " + line);
  for (const line of blocking) console.log("BLOCK " + line);
});
' <<< "$AUDIT_JSON")

if echo "$REPORT" | grep -q "^UNPARSEABLE$"; then
  echo "Could not parse the audit output:"
  echo "$AUDIT_JSON"
  exit 1
fi

echo "$REPORT" | grep "^WAIVED " | sed 's/^WAIVED /allowlisted: /'

BLOCKING=$(echo "$REPORT" | grep "^BLOCK " | sed 's/^BLOCK //')
if [ -n "$BLOCKING" ]; then
  echo "Blocking advisories:"
  echo "$BLOCKING"
  exit 1
fi

echo "No blocking advisories (allowlisted findings above are exempt)."
exit 0
