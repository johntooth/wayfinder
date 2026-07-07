#!/usr/bin/env bash
# Wire the lease blueprint to fire "on lease": register it as a service-managed
# CloudFormation StackSet with auto-deployment onto the Active (leased) OU. From
# then on, every account Innovation Sandbox moves into that OU gets a Wayfinder
# instance with no further action — the "click Request Lease → app launches" hook.
#
# Run in the ORG MANAGEMENT account, or a delegated CloudFormation admin account
# (then pass --delegated-admin).
#
#   register-stackset.sh --active-ou <ou-id> [--region <region>]
#                        [--stackset-name <name>] [--app-mode demo|production]
#                        [--git-url <url>] [--git-ref <ref>] [--model-id <id>]
#                        [--delegated-admin] [--yes]
#
# Idempotent: creates the StackSet if absent (else updates it), then ensures the
# OU is a deployment target. Requires trusted access between CloudFormation
# StackSets and Organizations (this script enables it if missing).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/wayfinder-lease-blueprint.yaml"

usage() {
  tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//' | head -18
  exit 1
}

ACTIVE_OU=""
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
STACKSET_NAME="wayfinder-lease"
APP_MODE="demo"
GIT_URL=""
GIT_REF=""
MODEL_ID=""
CALL_AS="SELF"
AUTO_APPROVE="false"
while [ $# -gt 0 ]; do
  case "$1" in
    --active-ou) ACTIVE_OU="${2:?--active-ou needs a value}" && shift ;;
    --region) REGION="${2:?--region needs a value}" && shift ;;
    --stackset-name) STACKSET_NAME="${2:?--stackset-name needs a value}" && shift ;;
    --app-mode) APP_MODE="${2:?--app-mode needs a value}" && shift ;;
    --git-url) GIT_URL="${2:?--git-url needs a value}" && shift ;;
    --git-ref) GIT_REF="${2:?--git-ref needs a value}" && shift ;;
    --model-id) MODEL_ID="${2:?--model-id needs a value}" && shift ;;
    --delegated-admin) CALL_AS="DELEGATED_ADMIN" ;;
    --yes) AUTO_APPROVE="true" ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
  shift
done

[ -n "$ACTIVE_OU" ] || { echo "error: --active-ou <ou-id> is required (the leased OU Innovation Sandbox moves accounts into)" >&2; usage; }
[ -f "$TEMPLATE" ] || { echo "error: template not found at $TEMPLATE" >&2; exit 1; }

# Template parameters — only pass the ones the caller overrode; the template's
# own defaults cover the rest.
PARAMS=("ParameterKey=AppMode,ParameterValue=$APP_MODE")
[ -n "$GIT_URL" ]  && PARAMS+=("ParameterKey=WayfinderGitUrl,ParameterValue=$GIT_URL")
[ -n "$GIT_REF" ]  && PARAMS+=("ParameterKey=WayfinderGitRef,ParameterValue=$GIT_REF")
[ -n "$MODEL_ID" ] && PARAMS+=("ParameterKey=BedrockModelId,ParameterValue=$MODEL_ID")

echo "StackSet:   $STACKSET_NAME"
echo "Template:   $TEMPLATE"
echo "Active OU:  $ACTIVE_OU"
echo "Region:     $REGION"
echo "App mode:   $APP_MODE"
echo "Call as:    $CALL_AS"
if [ "$AUTO_APPROVE" != "true" ]; then
  printf 'Proceed? [y/N] '; read -r reply; [ "$reply" = "y" ] || { echo "aborted"; exit 0; }
fi

# 1) Trusted access: service-managed StackSets require Organizations integration.
if ! aws organizations list-aws-service-access-for-organization \
      --query "EnabledServicePrincipals[?ServicePrincipal=='stacksets.cloudformation.amazonaws.com']" \
      --output text 2>/dev/null | grep -q stacksets; then
  echo "Enabling CloudFormation StackSets trusted access in Organizations..."
  aws cloudformation activate-organizations-access 2>/dev/null \
    || aws organizations enable-aws-service-access --service-principal stacksets.cloudformation.amazonaws.com
fi

# 2) Create (or update) the service-managed StackSet with auto-deployment.
if aws cloudformation describe-stack-set --stack-set-name "$STACKSET_NAME" \
     --call-as "$CALL_AS" >/dev/null 2>&1; then
  echo "StackSet exists — updating template/parameters..."
  aws cloudformation update-stack-set \
    --stack-set-name "$STACKSET_NAME" \
    --template-body "file://$TEMPLATE" \
    --parameters "${PARAMS[@]}" \
    --capabilities CAPABILITY_IAM \
    --permission-model SERVICE_MANAGED \
    --auto-deployment Enabled=true,RetainStacksOnAccountRemoval=false \
    --call-as "$CALL_AS" \
    --operation-preferences MaxConcurrentPercentage=100,FailureTolerancePercentage=25 \
    --deployment-targets OrganizationalUnitIds="$ACTIVE_OU" \
    --regions "$REGION"
else
  echo "Creating service-managed StackSet..."
  aws cloudformation create-stack-set \
    --stack-set-name "$STACKSET_NAME" \
    --description "Wayfinder sandbox-lease blueprint — auto-deploys on lease into the Active OU." \
    --template-body "file://$TEMPLATE" \
    --parameters "${PARAMS[@]}" \
    --capabilities CAPABILITY_IAM \
    --permission-model SERVICE_MANAGED \
    --auto-deployment Enabled=true,RetainStacksOnAccountRemoval=false \
    --call-as "$CALL_AS"
fi

# 3) Ensure the Active OU is a deployment target. Auto-deployment then covers
#    every future account moved into the OU; this call covers any already in it.
echo "Targeting Active OU $ACTIVE_OU in $REGION..."
aws cloudformation create-stack-instances \
  --stack-set-name "$STACKSET_NAME" \
  --deployment-targets OrganizationalUnitIds="$ACTIVE_OU" \
  --regions "$REGION" \
  --operation-preferences MaxConcurrentPercentage=100,FailureTolerancePercentage=25 \
  --call-as "$CALL_AS" 2>&1 | grep -v '^$' || true

echo
echo "Done. Accounts entering OU $ACTIVE_OU now auto-provision Wayfinder."
echo "Watch a rollout:  aws cloudformation list-stack-set-operations --stack-set-name $STACKSET_NAME --call-as $CALL_AS"
