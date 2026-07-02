#!/usr/bin/env bash
# Destroy a stamped Wayfinder environment and its terraform workspace.
#
#   destroy-environment.sh <name> [--auto-approve] [--via-tunnel [port]]
#
# The environment's S3 bucket must be empty first — S3 refuses to delete
# non-empty buckets. Destroying also removes the environment's database, so
# the same connectivity as stamping is required (--via-tunnel, default 5433).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVIRONMENTS_DIR="$SCRIPT_DIR/../environments"

usage() {
  tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//' | head -6
  exit 1
}

ENV_NAME="${1:-}"
[ -n "$ENV_NAME" ] || usage
shift

if ! [[ "$ENV_NAME" =~ ^[a-z][a-z0-9-]{1,14}$ ]] || [ "$ENV_NAME" = "default" ]; then
  echo "error: '$ENV_NAME' is not a valid environment name" >&2
  exit 1
fi

DESTROY_ARGS=(-var "env_name=$ENV_NAME")
TUNNEL_PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --auto-approve) DESTROY_ARGS+=(-auto-approve) ;;
    --via-tunnel)
      TUNNEL_PORT="5433"
      if [ $# -gt 1 ] && [[ "$2" =~ ^[0-9]+$ ]]; then
        TUNNEL_PORT="$2"
        shift
      fi
      ;;
    *) usage ;;
  esac
  shift
done

if [ -n "$TUNNEL_PORT" ]; then
  if ! (exec 3<> "/dev/tcp/127.0.0.1/$TUNNEL_PORT") 2> /dev/null; then
    echo "error: nothing listening on localhost:$TUNNEL_PORT — start the tunnel first:" >&2
    echo "       $SCRIPT_DIR/db-tunnel.sh $TUNNEL_PORT" >&2
    exit 1
  fi
  DESTROY_ARGS+=(-var "database_host_override=127.0.0.1" -var "database_port_override=$TUNNEL_PORT")
fi

command -v terraform > /dev/null || {
  echo "error: terraform is not installed" >&2
  exit 1
}

cd "$ENVIRONMENTS_DIR"
terraform workspace select "$ENV_NAME" || {
  echo "error: no workspace '$ENV_NAME' — nothing to destroy" >&2
  exit 1
}
terraform destroy "${DESTROY_ARGS[@]}"
terraform workspace select default
terraform workspace delete "$ENV_NAME"
echo "Environment '$ENV_NAME' destroyed and workspace deleted."
