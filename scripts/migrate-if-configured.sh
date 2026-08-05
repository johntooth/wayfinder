#!/usr/bin/env bash
# Applies pending migrations before the web app starts.
#
# Two escape hatches, in order:
#   - DATABASE_URL unset            → skip silently, so `pnpm dev` works in CI
#                                     lint/typecheck containers and for
#                                     contributors with no local Postgres.
#   - RUN_MIGRATIONS_ON_START=false → skip, for deployments that run the
#                                     `migrate` command as their own step
#                                     (ADR-047). Defaults to true so a clean
#                                     checkout still needs no database step.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${DATABASE_URL}" ]; then
  echo "[migrate] DATABASE_URL not set — skipping migrations."
  exit 0
fi

if [ "${RUN_MIGRATIONS_ON_START:-true}" = "false" ]; then
  echo "[migrate] RUN_MIGRATIONS_ON_START=false — skipping; run the migrate command separately."
  exit 0
fi

# The built bundle is what a deployment has; the TypeScript source is what a
# contributor has before anything is built. Neither path uses drizzle-kit, so no
# runtime code reaches a dev dependency.
if [ -f "$ROOT/apps/api/dist/cli/migrate.js" ]; then
  exec node "$ROOT/apps/api/dist/cli/migrate.js"
fi

exec pnpm --filter @wayfinder/api exec tsx "$ROOT/apps/api/src/cli/migrate.ts"
