#!/usr/bin/env bash
# Deploy the lease blueprint to the CURRENT account — the "vercel deploy" moment:
# one command, no config, into whatever account your credentials point at. Use it
# to smoke-test the blueprint in one leased account before wiring the fleet with
# register-stackset.sh.
#
#   deploy.sh [--region <region>] [--stack-name <name>] [--app-mode demo|production]
#             [--git-url <url>] [--git-ref <ref>] [--model-id <id>]
#
# On success it prints the SSM port-forward command — the user's only step.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/wayfinder-lease-blueprint.yaml"

usage() {
  tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//' | head -9
  exit 1
}

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
STACK_NAME="wayfinder-lease"
APP_MODE="demo"
GIT_URL=""
GIT_REF=""
MODEL_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="${2:?--region needs a value}" && shift ;;
    --stack-name) STACK_NAME="${2:?--stack-name needs a value}" && shift ;;
    --app-mode) APP_MODE="${2:?--app-mode needs a value}" && shift ;;
    --git-url) GIT_URL="${2:?--git-url needs a value}" && shift ;;
    --git-ref) GIT_REF="${2:?--git-ref needs a value}" && shift ;;
    --model-id) MODEL_ID="${2:?--model-id needs a value}" && shift ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
  shift
done

OVERRIDES=("AppMode=$APP_MODE")
[ -n "$GIT_URL" ]  && OVERRIDES+=("WayfinderGitUrl=$GIT_URL")
[ -n "$GIT_REF" ]  && OVERRIDES+=("WayfinderGitRef=$GIT_REF")
[ -n "$MODEL_ID" ] && OVERRIDES+=("BedrockModelId=$MODEL_ID")

echo "Deploying $STACK_NAME to $(aws sts get-caller-identity --query Account --output text) / $REGION (app-mode=$APP_MODE)..."
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "${OVERRIDES[@]}"

echo
echo "Stack up. First boot (clone → compose → pnpm → start) takes a few minutes."
echo
aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='PortForwardCommand'].OutputValue" --output text
echo "  → then open http://localhost:3000"
