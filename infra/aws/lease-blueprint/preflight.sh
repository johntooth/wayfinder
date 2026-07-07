#!/usr/bin/env bash
# Preflight: does a leased sandbox account actually permit what the Wayfinder
# lease blueprint needs? Run this INSIDE a freshly-leased account (with that
# account's credentials) before trusting the blueprint fleet-wide. It probes the
# active-lease guardrail (SCP) directly — the two things that silently break the
# deploy are (1) EC2/IAM denied by the SCP, (2) Bedrock model access not enabled.
#
#   preflight.sh [--region <region>] [--model-id <bedrock-id>] [--skip-iam]
#
# Every probe is non-destructive: EC2 uses --dry-run, the IAM probe creates a
# uniquely-named throwaway role and deletes it in a trap, Bedrock sends a
# 1-token message. Exits non-zero if any HARD blocker fails.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//' | head -11
  exit 1
}

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
MODEL_ID="apac.anthropic.claude-3-5-haiku-20241022-v1:0"
SKIP_IAM="false"
while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="${2:?--region needs a value}" && shift ;;
    --model-id) MODEL_ID="${2:?--model-id needs a value}" && shift ;;
    --skip-iam) SKIP_IAM="true" ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
  shift
done

FAILURES=0
pass()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
warn()  { printf '  \033[33mWARN\033[0m  %s\n' "$1"; }

# A dry-run EC2 call: DryRunOperation in stderr => permitted; UnauthorizedOperation
# => denied by IAM/SCP. Anything else is reported verbatim.
probe_ec2() {
  local label="$1"; shift
  local out
  if out=$(aws ec2 "$@" --dry-run --region "$REGION" 2>&1); then
    fail "$label — unexpected success without DryRunOperation ($out)"
    return
  fi
  case "$out" in
    *DryRunOperation*)       pass "$label allowed" ;;
    *UnauthorizedOperation*) fail "$label DENIED by guardrail (SCP/IAM)" ;;
    *)                       fail "$label inconclusive: $out" ;;
  esac
}

echo "Wayfinder lease preflight — region $REGION"
echo
CALLER=$(aws sts get-caller-identity --output text --query 'Arn' 2>&1) \
  && echo "Caller: $CALLER" || { echo "Cannot call STS — check credentials." >&2; exit 2; }
ACCOUNT=$(aws sts get-caller-identity --output text --query 'Account')
echo "Account: $ACCOUNT"
echo

echo "[1/4] EC2 — VPC + instance creation (the blueprint's host)"
probe_ec2 "ec2:CreateVpc" ec2 create-vpc --cidr-block 10.250.0.0/16
AMI=$(aws ssm get-parameter --region "$REGION" \
      --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
      --query 'Parameter.Value' --output text 2>/dev/null || true)
if [ -n "$AMI" ]; then
  probe_ec2 "ec2:RunInstances" ec2 run-instances --image-id "$AMI" --instance-type t3.xlarge --max-count 1 --min-count 1
else
  warn "ec2:RunInstances — could not resolve AL2023 AMI from SSM to probe (skipping)"
fi
echo

echo "[2/4] IAM — role + instance profile the template creates"
if [ "$SKIP_IAM" = "true" ]; then
  warn "IAM probe skipped (--skip-iam). Deploy needs iam:CreateRole/CreateInstanceProfile/PassRole."
else
  PROBE_ROLE="wayfinder-preflight-$(date +%s)-$RANDOM"
  cleanup_iam() {
    aws iam delete-role-policy --role-name "$PROBE_ROLE" --policy-name probe >/dev/null 2>&1 || true
    aws iam delete-role --role-name "$PROBE_ROLE" >/dev/null 2>&1 || true
  }
  trap cleanup_iam EXIT
  TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  if err=$(aws iam create-role --role-name "$PROBE_ROLE" --assume-role-policy-document "$TRUST" 2>&1); then
    pass "iam:CreateRole allowed"
    if aws iam put-role-policy --role-name "$PROBE_ROLE" --policy-name probe \
         --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"bedrock:InvokeModel","Resource":"*"}]}' >/dev/null 2>&1; then
      pass "iam:PutRolePolicy allowed"
    else
      fail "iam:PutRolePolicy DENIED — the inline Bedrock policy can't attach"
    fi
  else
    case "$err" in
      *AccessDenied*|*explicit*deny*) fail "iam:CreateRole DENIED by guardrail — the instance role can't be created" ;;
      *) fail "iam:CreateRole inconclusive: $err" ;;
    esac
  fi
  cleanup_iam
  trap - EXIT
fi
echo

echo "[3/4] Bedrock — invoke $MODEL_ID (tests SCP allow AND model access enabled)"
BODY='{"anthropic_version":"bedrock-2023-05-31","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
if err=$(aws bedrock-runtime invoke-model --region "$REGION" --model-id "$MODEL_ID" \
          --content-type application/json --accept application/json \
          --body "$(printf '%s' "$BODY" | base64 | tr -d '\n')" \
          /dev/stdout 2>&1 >/dev/null); then
  pass "bedrock:InvokeModel allowed AND model access enabled"
else
  case "$err" in
    *AccessDeniedException*|*explicit*deny*) fail "Bedrock DENIED — either the SCP blocks bedrock:InvokeModel or model access for $MODEL_ID is NOT enabled in this account (CloudFormation can't enable it — the account baseline must)" ;;
    *ValidationException*)                   fail "Bedrock model id rejected: $MODEL_ID — try a different inference-profile id ($err)" ;;
    *)                                        fail "Bedrock inconclusive: $err" ;;
  esac
fi
echo

echo "[4/4] SSM — the access path"
if aws ssm describe-instance-information --region "$REGION" >/dev/null 2>&1; then
  pass "ssm:DescribeInstanceInformation allowed (Session Manager reachable for port-forward)"
else
  warn "Could not query SSM here — the instance registers with its own role, not yours; verify Session Manager is usable in this account."
fi
echo

if [ "$FAILURES" -eq 0 ]; then
  echo "Preflight PASSED — this account can host the lease blueprint."
else
  echo "Preflight found $FAILURES blocker(s) — resolve before registering the StackSet."
  exit 1
fi
