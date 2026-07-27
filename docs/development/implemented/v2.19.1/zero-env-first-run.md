# Bug Fix — The zero-env first run does not work

## Symptom

Following the documented quick start leaves the app unusable:

```
docker compose up -d
./restart.sh                 # copies .env.example → .env, generates secrets
# → open the printed http://localhost:3000/setup?token=… link
```

The `/setup` and `/login` pages render, but creating the admin fails and every
subsequent call answers `500` with a `ZodError` body naming `ADMIN_SEED_EMAIL`:

```
{"error":{"json":{"message":"[{\"validation\":\"email\",\"code\":\"invalid_string\",
  \"message\":\"Invalid email\",\"path\":[\"ADMIN_SEED_EMAIL\"]}]", …
```

Severity: **blocker** — a fresh install cannot complete first-run setup, which
is the whole point of the wizard shipped in v2.18.0/v2.19.0.

Two further defects were found in the same sweep, both silent rather than loud:

- Every API boot logs `Scheduler enabled but not started: set
  SCHEDULER_TICK_URL and SCHEDULER_TICK_SECRET`, and scheduled sessions never
  fire.
- Email configured in Configuration → Email is discarded: the connectivity test
  reports "there is no live endpoint to verify" and sends go nowhere.

## Root cause (verified)

### 1. Blank optional env vars are read as invalid, not absent

`apps/web/src/lib/env.ts` parsed `process.env` directly:

```ts
cached = serverEnvSchema.parse(process.env);
```

`set -a; source .env` exports a blank-value line (`ADMIN_SEED_EMAIL=`) as an
**empty string**, not as an absent key. Zod counts `""` as a provided value, so
`z.string().email().optional()` rejects it — `.optional()` only tolerates
`undefined`. `.env.example` ships `ADMIN_SEED_EMAIL=` blank and `restart.sh`
copies that file to `.env`, so the advertised path lands on it every time.

`serverEnv()` is called lazily when the container is built, per request. That is
why the failure did not look like a boot error: `/login` and `/setup` are client
components and rendered normally, while every tRPC procedure and every Better
Auth route threw. Sign-in returned 500 against a page that looked healthy.

`apps/api/src/env.ts` already had the guard — `loadEnv()` maps `""` to
`undefined` before parsing — which is why the API booted fine on the same file
and the asymmetry went unnoticed. Two fields in the web schema
(`SMTP_TRANSPORT_MODE`, `SMTP_PORT`) carried a local `z.preprocess` doing the
same thing for themselves, so the problem was known in the small.

Confirmed by parsing the real `.env.example` through the real schema:

```
web serverEnv(.env.example) -> FAIL (1 issue(s))
   ADMIN_SEED_EMAIL: Invalid email
api loadEnv(.env.example)   -> PASS
```

### 2. The scheduler can never start on a default install

`SCHEDULER_ENABLED` defaults on (`value !== "false"`), but the heartbeat only
starts when `SCHEDULER_TICK_URL` **and** `SCHEDULER_TICK_SECRET` are both set
(`apps/api/src/container.ts`). Neither has a default and neither appeared
anywhere in `.env.example`, so no install that follows the documentation has
them. The result is a warning on every boot and schedules that silently never
fire — the same class of defect ADR-033 §6 fixed for the extraction worker by
defaulting it on.

The tick URL is derivable: it is always the web app's own
`/api/internal/scheduler/tick`, and the API already knows the web app's base URL
as `WEB_BASE_URL`. Only the shared secret is genuinely un-derivable, and the
endpoint refuses an unauthenticated tick by design.

### 3. `.env.example` disabled admin-configured email

The file shipped `SMTP_TRANSPORT_MODE=stream`. Per ADR-023 that var makes the
environment the source of truth for mail and takes precedence over the admin
config, so on a default install `NodemailerEmailSender` resolved to the stream
sink: `isConfigured()` returned false, `testConnectivity()` returned "Email
transport is in stream mode; there is no live endpoint to verify", and `send()`
built messages that were never delivered. This directly contradicts the header
of the file it lives in, which promises every integration is configured in-app.

### 4. `apps/api` ignored `MINIO_*`

`apps/api/src/container.ts` hardcoded its storage `EnvDefaults`
(`localhost:9000`, `minioadmin`) and the API env schema had no `MINIO_*` keys at
all, while the web app read them. An env-only deployment therefore had a web app
talking to S3 and an extraction worker looking for a local MinIO. A stored
`storage_config` row overrides both, which is why the wizard path masked it.

### 5. Three entries in `.env.example` were dead or misleading

- `APP_NAME` — read by no code; only `scripts/init-project.sh` rewrote it.
- `DOCUMENT_STORAGE_PATH` — declared in the web schema and referenced nowhere;
  the local-disk fallback it describes was replaced by MinIO in v1.5.0.
- `WEB_PORT` — `restart.sh` used it to choose which port to free, but
  `apps/web/package.json` hardcoded `next dev -p 3000`, so setting it to 3005
  freed 3005 and then started on 3000.

## Reproduction

1. From a clean checkout with Postgres running: `cp .env.example .env`
2. Add the two required secrets (or let `./restart.sh` do it).
3. `set -a; source .env; set +a`, then start the web app.
4. `curl -X POST localhost:3000/api/auth/sign-in/email -H 'content-type:
   application/json' -d '{"email":"…","password":"…"}'` → **500**, ZodError on
   `ADMIN_SEED_EMAIL`. The same happens on every `/api/trpc/*` call, including
   the unauthenticated `bootstrap.adminExists` the `/setup` page needs.
5. Start the API: it logs `Scheduler enabled but not started`.

## Fix plan

- `apps/web/src/lib/env.ts` — strip `""` to `undefined` before parsing, matching
  `loadEnv()`. Drop the two now-redundant per-field `z.preprocess` wrappers and
  the unused `DOCUMENT_STORAGE_PATH`.
- `apps/api/src/env.ts` — default `SCHEDULER_TICK_URL` to
  `${WEB_BASE_URL}/api/internal/scheduler/tick`; add the `MINIO_*` keys.
- `apps/api/src/container.ts` — read storage defaults from those keys.
- `restart.sh` — `ensure_secret SCHEDULER_TICK_SECRET` alongside the other two.
- `.env.example` — blank `SMTP_TRANSPORT_MODE`; drop `APP_NAME` and
  `DOCUMENT_STORAGE_PATH`; document the scheduler vars, `WEB_BASE_URL`,
  `N8N_WEBHOOK_SECRET`, and that `BETTER_AUTH_URL` must be set off localhost.
- `apps/web/package.json` — honour `WEB_PORT`.

Deliberately **not** changed: the env-over-admin precedence itself (ADR-023 is
intentional — only the shipped default was wrong), and `NOTIFICATIONS_ENABLED`
remaining an env-only switch with no admin override.

## Tests

- **Regression guard (unit):** `apps/web/src/lib/env.test.ts` — new file. Asserts
  blank optionals read as unset, that genuinely invalid non-empty values are
  still rejected, that the defaults a blank value used to produce are unchanged,
  and — the case that would have caught this — that the **real `.env.example`**,
  parsed the way `source` exports it, produces a valid env.
- **Regression guard (unit):** `apps/api/src/env.test.ts` — tick-URL derivation
  (default, custom `WEB_BASE_URL`, explicit override) and the `MINIO_*`
  fallbacks.
- **E2E:** `apps/web/e2e/fix-zero-env-first-run.spec.ts` — see the summary below.

## Version

PATCH bump: `2.19.0` → `2.19.1` (bug fixes, no schema impact).
