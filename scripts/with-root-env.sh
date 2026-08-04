#!/usr/bin/env bash
# with-root-env.sh — load the repo-root .env, then exec the given command.
#
#   scripts/with-root-env.sh <command> [args…]
#
# Turborepo 2.x runs every task in strict environment mode: a task inherits only
# a system allowlist, so the variables restart.sh exports before `pnpm turbo dev`
# never reach `next dev`, and the web app boots with no DATABASE_URL. Next.js
# reads .env files from the app directory (apps/web/.env), never from the repo
# root, so it cannot pick them up either. apps/api already avoids this by
# re-reading ../../.env through dotenv; this is the same idea for everything else.
#
# Values already present in the environment win, so `DATABASE_URL=… pnpm dev`
# still overrides the file, as does a CI job that sets its variables directly.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env"

if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in
      '' | '#'*) continue ;;
    esac

    line="${line#export }"
    name="${line%%=*}"
    value="${line#*=}"
    [ "$name" = "$line" ] && continue
    case "$name" in
      '' | *[!A-Za-z0-9_]*) continue ;;
    esac

    case "$value" in
      \"*\") value="${value#\"}" && value="${value%\"}" ;;
      \'*\') value="${value#\'}" && value="${value%\'}" ;;
    esac

    # eval rather than ${!name+x}: bash 3.2, still the system bash on macOS, does
    # not support indirect expansion combined with a test. The name is validated
    # above as [A-Za-z0-9_]+, so there is nothing here to inject.
    if eval "[ -z \"\${${name}+x}\" ]"; then
      export "${name}=${value}"
    fi
  done < "$ENV_FILE"
fi

exec "$@"
