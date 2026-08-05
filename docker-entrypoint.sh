#!/usr/bin/env bash
# One image, three jobs. The platform picks which by passing a command:
#
#   docker run … wayfinder            # web (the default)
#   docker run … wayfinder api        # scheduler + extraction workers
#   docker run … wayfinder migrate    # apply migrations, then exit
#
# Anything else is executed verbatim, so `docker run … wayfinder bash` still
# gets you a shell.
set -euo pipefail

case "${1:-web}" in
  web)
    exec pnpm --filter @wayfinder/web start
    ;;
  api)
    exec pnpm --filter @wayfinder/api start
    ;;
  migrate)
    exec node /app/apps/api/dist/cli/migrate.js
    ;;
  *)
    exec "$@"
    ;;
esac
