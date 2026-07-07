# Wayfinder — Sandbox-Lease Blueprint

IaC an admin drops into the **GovAI Innovation Sandbox** so that from the moment a
user clicks **request lease**, a working Wayfinder dev/demo instance exists in the
leased account with **no material configuration** — no API keys, no domain, no
manual steps.

A lease is ephemeral, cost-capped, guardrailed, and has no domain, so this
blueprint collapses the whole stack onto **one EC2 host in a purpose-built VPC**:
backing services (Postgres + MinIO) run under docker-compose, the app itself is
built and run natively with Node.js + pnpm at `/opt/wayfinder`, and it gets its AI
from **Amazon Bedrock via the instance role** (the trick that deletes the `sk-…`
secret — the only material config Wayfinder otherwise has). Access is a single
**SSM port-forward → `localhost:3000`** — no inbound ports, no SSH key, no public
URL.

```
request lease ─► account enters Active OU ─► StackSet auto-deploys this template
                                              │
                                              ▼
        VPC ─ public subnet ─ IGW ─ route table ─ security group (egress only)
                                              │
                                              ▼
                         EC2 (Amazon Linux 2023)   /opt/wayfinder
                         ├─ docker-compose: postgres (pgvector) + minio
                         └─ native pnpm: web :3000  +  api :3001
                                              │
                                              ▼  IMDSv2 → instance role
                                    Amazon Bedrock  (no key)

  user ─► aws ssm start-session … PortForwardingSession 3000 ─► http://localhost:3000
```

This is a deliberately different animal from `infra/aws/` (the always-on
VPC/ECS/RDS/ALB blueprint for permanent hosting). This one is single-host,
throwaway-with-the-lease, and zero-config.

## Files

| File | What it is |
|---|---|
| `wayfinder-lease-blueprint.yaml` | CloudFormation: VPC/subnet/IGW/route-table + security group + EC2 + instance role + user-data bootstrap |
| `preflight.sh` | Run in a leased account to confirm the guardrail permits EC2/IAM/Bedrock **before** trusting the blueprint |
| `deploy.sh` | One-command deploy to the current account — the "vercel deploy" smoke test |
| `register-stackset.sh` | Wire it to fire **on lease** — service-managed StackSet auto-deploying onto the Active OU |

The runtime backing services come from the repo's own root `docker-compose.yml`
(only the `postgres` and `storage` services are started — the app runs natively).

## Deploy — as close to `vercel deploy` as CloudFormation gets

Three commands, in order. The first two are for the admin setting it up; after
that no human touches AWS — a lease *is* the deploy trigger.

```bash
# 0. (one-time) prove a leased account can actually host it — run with that
#    account's creds. Fails loudly if the SCP blocks EC2/IAM or Bedrock model
#    access isn't enabled (the two things that silently break the launch).
./preflight.sh --region ap-southeast-2

# 1. smoke-test in one account — one command, no config, prints the port-forward
#    line on success. This is the "vercel deploy" moment.
./deploy.sh --region ap-southeast-2

# 2. make it fleet-wide + automatic: register the StackSet on the Active OU so
#    every future lease provisions Wayfinder with zero further action. Run in the
#    org management (or delegated-admin) account.
./register-stackset.sh --active-ou ou-xxxx-xxxxxxxx --region ap-southeast-2
```

After step 2 the flow is genuinely **Request Lease → app launches**: Innovation
Sandbox moves the leased account into the Active OU → the StackSet auto-deploys
this template → user runs the one port-forward line → `localhost:3000`.

Both `deploy.sh` and `register-stackset.sh` take `--app-mode`, `--git-url`,
`--git-ref`, and `--model-id` to override the template defaults; run any script
with `-h` for the full list.

## What the template creates

| Piece | How |
|---|---|
| VPC + subnet + IGW + route table | Created by this CloudFormation stack (`10.20.0.0/16` by default) |
| Security group | Explicitly bound to the VPC — **egress only**, no inbound (access is via SSM) |
| EC2 instance | Launched into the new subnet automatically (Amazon Linux 2023) |
| Docker Compose | Installed both as CLI plugin (`docker compose`) and standalone (`docker-compose`) |
| Node.js + pnpm | Installed in user-data (Node 20 via NodeSource, pnpm via corepack) |
| App build + start | `pnpm install` (+ `pnpm build` in production mode) then started via systemd |
| `.env` creation | Heredoc with a unique delimiter (`WAYFINDER_ENV_EOF`) — no indentation issues |
| App location | `/opt/wayfinder`, `a+rX` (readable by all users) |
| Durability | `wayfinder-web` / `wayfinder-api` **systemd** units — survive reboots, restart on failure |

The zero-config AI path: `AI_DEFAULT_PROVIDER=bedrock` with **blank** Bedrock keys,
so the AWS default credential chain → IMDSv2 → the **instance role** authorises
Bedrock. No `sk-…` secret anywhere.

## `AppMode` — the one knob that matters

| `AppMode` | Runtime | First open of `localhost:3000` |
|---|---|---|
| `demo` *(default)* | `NODE_ENV=development`, `AUTH_BYPASS=true`, dev servers | Lands **straight in the app** — the true "just Request Lease" path |
| `production` | `NODE_ENV=production`, `pnpm build && pnpm start`, real auth | Register an admin at `/admin/register` first (`AUTH_BYPASS` is hard-disabled in prod) |

Default is `demo` because that is what actually closes the gap to one click. Use
`production` only when you want a realistic-auth demo and don't mind the register step.

## How the "on lease" hook works

`register-stackset.sh` (step 2 above) creates a **service-managed CloudFormation
StackSet** with **auto-deployment** targeting the **Active / leased OU**. When
Innovation Sandbox moves a freshly-leased account into that OU, the StackSet
instantiates this template into it — that is the "runs when they click request
lease" hook. The script also enables the CloudFormation ↔ Organizations trusted
access the mechanism needs, and is idempotent (re-run to push a template change).

First boot takes a few minutes (packages → clone → `compose up` → `pnpm install`
→ migrate → start). Watch it on the instance via an SSM shell
(`aws ssm start-session --target <instance-id>`) at
`/var/log/wayfinder-bootstrap.log`.

(If your edition uses Service Catalog products instead of StackSets, publish the
same template as a product in the portfolio shared to the Active OU — the template
is mechanism-agnostic; only the "on lease" wiring differs.)

## The user's only step, after the lease is granted

The stack output `PortForwardCommand` is copy-pasteable:

```bash
aws ssm start-session \
  --region <region> --target <instance-id> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}'
# then open http://localhost:3000
```

Requires AWS credentials for the lease account and the
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html).
Nothing else — no key pair, no security-group opening, no public URL.

## Confirm before you rely on it

Check against the **active-lease guardrail SCP** (couldn't be verified from the
un-leased pool account, which denies everything but SSM):

- [ ] `ec2:CreateVpc/Subnet/InternetGateway/RouteTable/SecurityGroup`,
      `ec2:RunInstances`, and `iam:PassRole` to the instance profile are allowed,
      and `InstanceType` isn't blocked by a cost guardrail.
- [ ] `bedrock:InvokeModel` allowed for `BedrockModelId`, **and that model's
      access is already enabled** in leased accounts (CloudFormation can't enable
      it — the account baseline must; the `apac.` Claude Haiku default is the safe
      pick unless the baseline enables Sonnet/Opus).
- [ ] Outbound internet + SSM endpoints reachable from the public subnet (git,
      image pulls, npm, Session Manager).

## Follow-up (not needed for a demo lease)

- **Persistent documents in real S3.** Documents live in in-container MinIO (dies
  with the lease — fine for dev/demo). For a real bucket with role auth, swap the
  storage adapter to `@aws-sdk/client-s3` and add an `AWS::S3::Bucket` +
  `s3:*Object` statements to `InstanceRole`.
- **Private subnet + VPC endpoints.** To drop the public IP, add a NAT gateway (or
  SSM/Bedrock/ECR/S3 interface+gateway VPC endpoints) and set
  `MapPublicIpOnLaunch: false`. Public subnet is the no-NAT-cost default.
