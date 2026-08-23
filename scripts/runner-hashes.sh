#!/usr/bin/env bash
# runner-hashes.sh — prints a stable content hash for every file in the session
# runner, one `<sha256>  <path>` line per file, sorted by path.
#
# The runner is the production execution path a flow test session runs on
# (ADR-048). validate.sh check 24 compares this output against the recorded
# baseline in runner-guard-baseline.txt.
#
# To accept a deliberate runner change, regenerate the baseline in the same
# commit as the change:
#
#   ./scripts/runner-hashes.sh > scripts/runner-guard-baseline.txt
#
# `shasum` rather than `sha256sum`: macOS ships the former and not the latter.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUNNER_PATHS=(
  "packages/application/src/use-cases/session/run-turn.ts"
  "packages/application/src/use-cases/session/evaluate-step-readiness.ts"
  "packages/adapters/src/agents/flow-session-graph.ts"
  "apps/web/src/app/api/chat"
)

for runner_path in "${RUNNER_PATHS[@]}"; do
  if [ -d "$runner_path" ]; then
    find "$runner_path" -type f \( -name '*.ts' -o -name '*.tsx' \)
  elif [ -f "$runner_path" ]; then
    printf '%s\n' "$runner_path"
  fi
done | LC_ALL=C sort | while IFS= read -r runner_file; do
  shasum -a 256 "$runner_file"
done
