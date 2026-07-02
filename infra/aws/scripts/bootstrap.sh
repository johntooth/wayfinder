#!/usr/bin/env bash
# One-command core setup for a fresh AWS account (ADR-035): preflight, state
# bucket, backend.hcl, core tfvars, core apply, image build+push.
#
#   bootstrap.sh --region <region> --state-bucket <bucket> --base-domain <domain>
#                (--route53-zone-id <zone> | --certificate-arn <arn>)
#                [--project <name>] [--skip-images] [--yes]
#
# Idempotent: every step skips what already exists, so re-running after a
# failure resumes where it stopped. Existing backend.hcl / terraform.tfvars
# files are never overwritten.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$SCRIPT_DIR/.."
REPO_ROOT="$SCRIPT_DIR/../../.."

usage() {
  tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//' | head -10
  exit 1
}

REGION=""
STATE_BUCKET=""
BASE_DOMAIN=""
ZONE_ID=""
CERT_ARN=""
PROJECT="wayfinder"
SKIP_IMAGES="false"
AUTO_APPROVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="${2:?--region needs a value}" && shift ;;
    --state-bucket) STATE_BUCKET="${2:?--state-bucket needs a value}" && shift ;;
    --base-domain) BASE_DOMAIN="${2:?--base-domain needs a value}" && shift ;;
    --route53-zone-id) ZONE_ID="${2:?--route53-zone-id needs a value}" && shift ;;
    --certificate-arn) CERT_ARN="${2:?--certificate-arn needs a value}" && shift ;;
    --project) PROJECT="${2:?--project needs a value}" && shift ;;
    --skip-images) SKIP_IMAGES="true" ;;
    --yes) AUTO_APPROVE="-auto-approve" ;;
    *) usage ;;
  esac
  shift
done

[ -n "$REGION" ] && [ -n "$STATE_BUCKET" ] && [ -n "$BASE_DOMAIN" ] || usage
if [ -z "$ZONE_ID" ] && [ -z "$CERT_ARN" ]; then
  echo "error: provide --route53-zone-id (core issues the wildcard cert) or --certificate-arn (bring your own)" >&2
  exit 1
fi

step() { echo; echo "── $1"; }

# ── Preflight ─────────────────────────────────────────────────────────────────
step "preflight"
for BINARY in aws terraform; do
  command -v "$BINARY" > /dev/null || {
    echo "error: '$BINARY' is not installed — install it and re-run" >&2
    exit 1
  }
done
aws sts get-caller-identity --query Account --output text > /dev/null 2>&1 || {
  echo "error: AWS credentials not configured (aws sts get-caller-identity failed) — run 'aws configure' or set AWS_PROFILE" >&2
  exit 1
}
if [ "$SKIP_IMAGES" = "false" ] && ! docker info > /dev/null 2>&1; then
  echo "warning: docker is unavailable — continuing with --skip-images (push images later, see README §2)" >&2
  SKIP_IMAGES="true"
fi
echo "ok: aws + terraform present, credentials valid"

# ── State bucket ──────────────────────────────────────────────────────────────
step "state bucket s3://$STATE_BUCKET"
if aws s3api head-bucket --bucket "$STATE_BUCKET" 2> /dev/null; then
  echo "ok: bucket exists"
else
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
  aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
    --versioning-configuration Status=Enabled
  echo "ok: bucket created (versioned)"
fi

# ── Config files (never overwritten) ─────────────────────────────────────────
step "config files"
if [ -f "$INFRA_DIR/backend.hcl" ]; then
  echo "ok: backend.hcl exists — leaving it alone"
else
  printf 'bucket = "%s"\nregion = "%s"\n' "$STATE_BUCKET" "$REGION" > "$INFRA_DIR/backend.hcl"
  echo "ok: wrote backend.hcl"
fi

if [ -f "$INFRA_DIR/core/terraform.tfvars" ]; then
  echo "ok: core/terraform.tfvars exists — leaving it alone"
else
  {
    printf 'aws_region      = "%s"\n' "$REGION"
    printf 'project_name    = "%s"\n' "$PROJECT"
    printf 'base_domain     = "%s"\n' "$BASE_DOMAIN"
    [ -n "$ZONE_ID" ] && printf 'route53_zone_id = "%s"\n' "$ZONE_ID"
    [ -n "$CERT_ARN" ] && printf 'certificate_arn = "%s"\n' "$CERT_ARN"
  } > "$INFRA_DIR/core/terraform.tfvars"
  echo "ok: wrote core/terraform.tfvars"
fi

if [ -f "$INFRA_DIR/environments/terraform.tfvars" ]; then
  echo "ok: environments/terraform.tfvars exists — leaving it alone"
else
  {
    printf 'aws_region   = "%s"\n' "$REGION"
    printf 'state_bucket = "%s"\n' "$STATE_BUCKET"
  } > "$INFRA_DIR/environments/terraform.tfvars"
  echo "ok: wrote environments/terraform.tfvars"
fi

# ── Core stack ────────────────────────────────────────────────────────────────
step "core stack"
if [ -n "$ZONE_ID" ] && [ -z "$CERT_ARN" ]; then
  echo "note: certificate will be issued via DNS validation — this hangs if the"
  echo "      zone $ZONE_ID does not actually serve $BASE_DOMAIN's NS records"
fi
terraform -chdir="$INFRA_DIR/core" init -backend-config=../backend.hcl -input=false
# shellcheck disable=SC2086 — AUTO_APPROVE is intentionally empty or a flag
terraform -chdir="$INFRA_DIR/core" apply -input=false $AUTO_APPROVE

# ── Images ────────────────────────────────────────────────────────────────────
if [ "$SKIP_IMAGES" = "false" ]; then
  step "images"
  WEB_REPO=$(terraform -chdir="$INFRA_DIR/core" output -raw web_ecr_repository_url)
  SEMCHUNK_REPO=$(terraform -chdir="$INFRA_DIR/core" output -raw semchunk_ecr_repository_url)
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "${WEB_REPO%%/*}"
  docker build -f "$REPO_ROOT/Dockerfile.web" -t "$WEB_REPO:latest" "$REPO_ROOT"
  docker push "$WEB_REPO:latest"
  docker build -t "$SEMCHUNK_REPO:latest" "$REPO_ROOT/services/semchunk"
  docker push "$SEMCHUNK_REPO:latest"
  echo "ok: images pushed"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
step "done"
cat <<NEXT
Core is up. Stamp your first environment:

  terraform -chdir=$INFRA_DIR/environments init -backend-config=../backend.hcl
  $SCRIPT_DIR/db-tunnel.sh &                    # SSM tunnel for stamping
  $SCRIPT_DIR/new-environment.sh dev --via-tunnel

Each stamp prints its URL and the two follow-ups (AI key secret, pgvector).
NEXT
