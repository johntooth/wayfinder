#!/usr/bin/env bash
# Stamp a Wayfinder environment (ADR-034): one command per environment.
#
#   new-environment.sh <name> [--enable-semchunk] [--plan] [--via-tunnel [port]]
#                             [--web-tag <tag>] [--semchunk-tag <tag>]
#
# --via-tunnel stamps through the SSM database tunnel (start it first:
# scripts/db-tunnel.sh). Default tunnel port 5433.
#
# Prerequisites (see ../README.md): core stack applied, backend configured in
# ../environments/versions.tf, terraform.tfvars present in ../environments,
# and a network path to the shared RDS server for the postgresql provider.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVIRONMENTS_DIR="$SCRIPT_DIR/../environments"

usage() {
  tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//' | head -7
  exit 1
}

ENV_NAME="${1:-}"
[ -n "$ENV_NAME" ] || usage
shift

if ! [[ "$ENV_NAME" =~ ^[a-z][a-z0-9-]{1,14}$ ]] || [ "$ENV_NAME" = "default" ]; then
  echo "error: '$ENV_NAME' is not a valid environment name" >&2
  echo "       (2-15 chars, lowercase alphanumeric/hyphen, starts with a letter, not 'default')" >&2
  exit 1
fi

ENABLE_SEMCHUNK="false"
ACTION="apply"
WEB_TAG=""
SEMCHUNK_TAG=""
TUNNEL_PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --enable-semchunk) ENABLE_SEMCHUNK="true" ;;
    --plan) ACTION="plan" ;;
    --via-tunnel)
      TUNNEL_PORT="5433"
      if [ $# -gt 1 ] && [[ "$2" =~ ^[0-9]+$ ]]; then
        TUNNEL_PORT="$2"
        shift
      fi
      ;;
    --web-tag)
      WEB_TAG="${2:?--web-tag needs a value}"
      shift
      ;;
    --semchunk-tag)
      SEMCHUNK_TAG="${2:?--semchunk-tag needs a value}"
      shift
      ;;
    *) usage ;;
  esac
  shift
done

command -v terraform > /dev/null || {
  echo "error: terraform is not installed" >&2
  exit 1
}
[ -d "$ENVIRONMENTS_DIR/.terraform" ] || {
  echo "error: $ENVIRONMENTS_DIR is not initialised — configure the backend in versions.tf, then run: terraform -chdir=$ENVIRONMENTS_DIR init" >&2
  exit 1
}

VAR_ARGS=(-var "env_name=$ENV_NAME" -var "enable_semchunk=$ENABLE_SEMCHUNK")
[ -n "$WEB_TAG" ] && VAR_ARGS+=(-var "web_image_tag=$WEB_TAG")
[ -n "$SEMCHUNK_TAG" ] && VAR_ARGS+=(-var "semchunk_image_tag=$SEMCHUNK_TAG")
if [ -n "$TUNNEL_PORT" ]; then
  if ! (exec 3<> "/dev/tcp/127.0.0.1/$TUNNEL_PORT") 2> /dev/null; then
    echo "error: nothing listening on localhost:$TUNNEL_PORT — start the tunnel first:" >&2
    echo "       $SCRIPT_DIR/db-tunnel.sh $TUNNEL_PORT" >&2
    exit 1
  fi
  VAR_ARGS+=(-var "database_host_override=127.0.0.1" -var "database_port_override=$TUNNEL_PORT")
fi

cd "$ENVIRONMENTS_DIR"
terraform workspace select -or-create "$ENV_NAME"
terraform "$ACTION" "${VAR_ARGS[@]}"

if [ "$ACTION" = "apply" ]; then
  echo
  echo "Environment '$ENV_NAME' stamped."
  echo "  URL:              $(terraform output -raw url)"
  echo "  Operator secrets: terraform output operator_secrets   (populate the AI key, then force a new ECS deployment)"
  echo "  pgvector:         run 'CREATE EXTENSION IF NOT EXISTS vector;' once in database $(terraform output -raw database_name)"
fi
