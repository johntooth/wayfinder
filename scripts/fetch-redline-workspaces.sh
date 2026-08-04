#!/usr/bin/env bash
# fetch-redline-workspaces.sh — put redline's @redline/* packages where this
# fork's pnpm-workspace.yaml expects to find them.
#
# WHY THIS EXISTS
# This fork is redline's `services/wayfinder` submodule, so apps/web resolves
# @redline/redline-* through the `../../apps/*` and `../../packages/*` globs in
# pnpm-workspace.yaml. A developer gets those for free — the parent checkout is
# redline itself. CI does not: actions/checkout clones this repo alone, the two
# globs match nothing, and every @redline/* import fails to resolve. Note that
# `pnpm install --frozen-lockfile` still *succeeds* in that state (it skips
# resolution), so the breakage only surfaces later as TS2307 at typecheck or as
# a boot failure under e2e. Any lockfile-updating install fails outright.
#
# So CI calls this before installing, and gets the same composed workspace a
# developer already has. It is deliberately a plain clone rather than an
# actions/checkout step: the packages have to land at a real path two levels up
# from this repo, which is outside GITHUB_WORKSPACE (checkout refuses that), and
# a symlink is not good enough — pnpm writes node_modules symlinks relative to
# the real path, so resolving through a linked parent breaks redline's own
# dependencies.
#
# No token needed: DeepCivic/Redline is public.

set -euo pipefail

FORK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT_ROOT="$(cd "$FORK_ROOT/../.." && pwd)"

REDLINE_REPO="${REDLINE_REPO:-https://github.com/DeepCivic/Redline.git}"
REDLINE_REF="${REDLINE_REF:-main}"

# The developer case: the parent checkout is already redline. Nothing to do, and
# nothing may be overwritten — this is somebody's working tree.
if [ -d "$PARENT_ROOT/packages/redline-domain" ]; then
  echo "redline workspaces already present at $PARENT_ROOT — nothing to do."
  exit 0
fi

# Refuse rather than merge into a parent that already has these directories for
# some unrelated reason. Landing a clone on top of them would be destructive.
for existing in apps packages tsconfig.base.json; do
  if [ -e "$PARENT_ROOT/$existing" ]; then
    echo "Refusing to overwrite $PARENT_ROOT/$existing — it already exists but holds no redline packages." >&2
    exit 1
  fi
done

CLONE_DIR="$(mktemp -d)"
trap 'rm -rf "$CLONE_DIR"' EXIT

echo "Cloning $REDLINE_REPO@$REDLINE_REF for its @redline/* workspace packages…"
git clone --depth=1 --branch "$REDLINE_REF" --quiet "$REDLINE_REPO" "$CLONE_DIR/redline"

mv "$CLONE_DIR/redline/apps" "$PARENT_ROOT/apps"
mv "$CLONE_DIR/redline/packages" "$PARENT_ROOT/packages"

# Every redline package tsconfig extends ../../tsconfig.base.json. Without it
# vitest's tsconfck resolution throws before a single test runs, so the root
# file travels with the packages.
mv "$CLONE_DIR/redline/tsconfig.base.json" "$PARENT_ROOT/tsconfig.base.json"

echo "Placed redline's apps/, packages/ and tsconfig.base.json at $PARENT_ROOT."
