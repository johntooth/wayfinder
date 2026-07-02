#!/usr/bin/env bash
# Open an SSM port-forward to the shared RDS server through the core bastion
# (ADR-035), so environment stamping works from anywhere:
#
#   db-tunnel.sh [local_port]     # default 5433; keep it running, then
#   new-environment.sh <name> --via-tunnel [local_port]
#
# Requires: aws CLI with the Session Manager plugin, core stack applied with
# enable_bastion = true.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/../core"
LOCAL_PORT="${1:-5433}"

command -v aws > /dev/null || {
  echo "error: aws CLI is not installed" >&2
  exit 1
}
[ -d "$CORE_DIR/.terraform" ] || {
  echo "error: core is not initialised — run scripts/bootstrap.sh (or terraform -chdir=core init) first" >&2
  exit 1
}

BASTION_ID=$(terraform -chdir="$CORE_DIR" output -raw bastion_instance_id 2> /dev/null || true)
if [ -z "$BASTION_ID" ] || [ "$BASTION_ID" = "null" ]; then
  echo "error: bastion is disabled (enable_bastion = false) — use one of the other" >&2
  echo "       database connectivity options in infra/aws/README.md" >&2
  exit 1
fi
DB_HOST=$(terraform -chdir="$CORE_DIR" output -raw database_host)
DB_PORT=$(terraform -chdir="$CORE_DIR" output -raw database_port)

echo "Forwarding localhost:$LOCAL_PORT → $DB_HOST:$DB_PORT via $BASTION_ID (Ctrl-C to stop)"
exec aws ssm start-session \
  --target "$BASTION_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$DB_HOST,portNumber=$DB_PORT,localPortNumber=$LOCAL_PORT"
