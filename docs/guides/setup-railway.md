# Railway Deployment

This guide deploys Wayfinder to [Railway](https://railway.app).

## 1. Create a new Railway project

1. Go to https://railway.app/new
2. Select **Deploy from GitHub repo** and connect your fork of `wayfinder`
3. Railway detects the monorepo. You will need two services: `web` and `api`.

Alternatively, use the Railway CLI:

```bash
railway login
railway init
```

## 2. Add required services

In your Railway project, add:

- **PostgreSQL** plugin (provides `DATABASE_URL` automatically)
- **MinIO plugin** — or have an external S3-compatible store ready (Backblaze B2,
  AWS S3, etc.). You do not configure it here; you point the setup wizard at it
  after the first deploy.

## 3. Environment variable mapping

[`.env.min.example.prod`](../../.env.min.example.prod) in the repo root is the
smallest working set for a deployment, with each value explained. That is the
whole list — set these on both the `web` and `api` services and nothing else:

| Wayfinder variable | Source |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Injected by Railway Postgres plugin |
| `BETTER_AUTH_SECRET` | Generate: `openssl rand -hex 32` |
| `SETTINGS_ENCRYPTION_KEY` | Generate: `openssl rand -hex 32`. Required at startup — encrypts the integration credentials the setup wizard stores, so back it up; losing it makes those rows unreadable |
| `BETTER_AUTH_URL` | Your Railway-assigned URL, e.g. `https://wayfinder-web.up.railway.app` |
| `WEB_BASE_URL` | The same URL — `api` uses it for the scheduler tick endpoint and for links in notification emails |
| `SCHEDULER_TICK_SECRET` | Generate: `openssl rand -hex 32`. The same value on both services; without it scheduled sessions never fire |
| `ADMIN_SEED_EMAIL` | Optional — pre-fills and binds the admin email on `/setup` |

**Object storage and the AI provider are not set here.** The administrator
configures both in the setup wizard after the first deploy; it tests each
connection before accepting it and stores the credentials encrypted in the
database. Setting `MINIO_*` or a provider API key in the environment is an
env-only install — a fallback for automated provisioning, documented in
[`.env.example`](../../.env.example), not the normal path.

## 4. Deploy

Push to `main` (or trigger a manual deploy). Railway builds and deploys both services.

## 5. First login and setup

Navigate to your Railway-assigned URL. On first boot with no admin, the app
prints a `https://your-host/setup?token=…` link to the `web` service log — open
it, create the administrator, then complete the setup wizard: object storage, AI
provider and sign-in method are all configured here, each tested before it is
accepted.

If `ADMIN_SEED_EMAIL` is set, the setup screen pre-fills it and only that address
may create the admin.

For sign-in by magic link, configure a real email transport — see the `SMTP_*`
and `M365_*` variables in [`.env.example`](../../.env.example), or the wizard's
email step.

## 6. Verify

- Log in as admin
- Navigate to **Admin → Flows** — you should see the empty state
- Upload a test document template via a `generate_document` node
- Check the MinIO / S3 bucket — the file should appear under `templates/`
- Check the `api` service log for `scheduler heartbeat started`
