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
- **MinIO plugin** — or point at an external S3-compatible store (Backblaze B2, AWS S3, etc.)

## 3. Environment variable mapping

`.env.min.example.prod` in the repo root is the smallest working set for a
deployment, with each value explained. Set the following on both the `web` and
`api` services:

| Wayfinder variable | Source |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Injected by Railway Postgres plugin |
| `BETTER_AUTH_SECRET` | Generate: `openssl rand -hex 32` |
| `SETTINGS_ENCRYPTION_KEY` | Generate: `openssl rand -hex 32`. Required at startup — encrypts the integration credentials the setup wizard stores, so back it up; losing it makes those rows unreadable |
| `BETTER_AUTH_URL` | Your Railway-assigned URL, e.g. `https://wayfinder-web.up.railway.app` |
| `WEB_BASE_URL` | The same URL — `api` uses it for the scheduler tick endpoint and for links in notification emails |
| `SCHEDULER_TICK_SECRET` | Generate: `openssl rand -hex 32`. The same value on both services; without it scheduled sessions never fire |
| `ADMIN_SEED_EMAIL` | Your admin email |
| `AI_DEFAULT_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | Your key |
| `MINIO_ENDPOINT` | MinIO plugin hostname or your S3 endpoint |
| `MINIO_PORT` | `443` for HTTPS, `9000` for plain HTTP |
| `MINIO_ACCESS_KEY` | MinIO / S3 access key |
| `MINIO_SECRET_KEY` | MinIO / S3 secret key |
| `MINIO_BUCKET` | `wayfinder-documents` |
| `MINIO_USE_SSL` | `true` (Railway uses HTTPS) |

**Set `ADMIN_SEED_EMAIL` before the first deploy** — the seed runs on startup.

## 4. Deploy

Push to `main` (or trigger a manual deploy). Railway builds and deploys both services.

## 5. First login

Navigate to your Railway-assigned URL. Request a magic link for the email in
`ADMIN_SEED_EMAIL`. Check the Railway log for your `web` service — in development
mode the link is printed there. In production, configure a real email provider
(SMTP or Resend) via the Better Auth configuration.

## 6. Verify

- Log in as admin
- Navigate to **Admin → Flows** — you should see the empty state
- Upload a test document template via a `generate_document` node
- Check the MinIO / S3 bucket — the file should appear under `templates/`
