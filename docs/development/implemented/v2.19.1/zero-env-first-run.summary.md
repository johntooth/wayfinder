# Implementation summary — zero-env first run (v2.19.1)

Diagnosis and reproduction: [`zero-env-first-run.md`](./zero-env-first-run.md).

## Root cause

`apps/web/src/lib/env.ts` parsed `process.env` directly. `set -a; source .env`
exports a blank-value line as an empty string, and Zod treats `""` as a provided
value that fails `.email()` / `.url()` rather than as an absent one, so
`.env.example`'s `ADMIN_SEED_EMAIL=` made `serverEnv()` throw. Because the
container is built lazily per request, the app still served its client-rendered
`/login` and `/setup` shells while every tRPC procedure and Better Auth route
answered 500 — so the documented `cp .env.example .env` quick start could not
complete first-run setup. `apps/api/src/env.ts` already stripped blanks in
`loadEnv()`, which is why the API booted on the same file.

Four further defects in the same surface, detailed in the diagnosis: the
scheduler could never start on a default install, `.env.example` shipped
`SMTP_TRANSPORT_MODE=stream` (which silently overrides admin-configured email),
`apps/api` hardcoded its object-storage defaults, and three documented vars were
dead or ignored.

## Fix applied

| File | Change |
|---|---|
| `apps/web/src/lib/env.ts` | Map `""` → `undefined` before `parse`, matching `loadEnv()`. Removed the two now-redundant per-field `z.preprocess` wrappers (`SMTP_TRANSPORT_MODE`, `SMTP_PORT`) and the unused `DOCUMENT_STORAGE_PATH`. |
| `apps/api/src/env.ts` | `SCHEDULER_TICK_URL` defaults to `${WEB_BASE_URL}/api/internal/scheduler/tick` (trailing slash trimmed), so only the un-derivable shared secret gates the heartbeat. Added the `MINIO_*` keys. |
| `apps/api/src/container.ts` | Storage `EnvDefaults` now read from `MINIO_*` instead of being hardcoded to `localhost:9000` / `minioadmin`. A stored `storage_config` row still wins. |
| `apps/api/src/index.ts` | The "not started" warning now names only the secret, and says what it costs (scheduled sessions do not fire). |
| `restart.sh` | `ensure_secret SCHEDULER_TICK_SECRET` alongside the other two, so the local stack schedules out of the box. |
| `apps/web/package.json` | `dev`/`start` use `-p ${WEB_PORT:-3000}` so the documented var takes effect. |
| `.env.example` | `SMTP_TRANSPORT_MODE` blank; `APP_NAME` and `DOCUMENT_STORAGE_PATH` removed; scheduler vars, `WEB_BASE_URL` and `N8N_WEBHOOK_SECRET` documented; `BETTER_AUTH_URL` marked as required off localhost; header notes that every value may be left blank. |
| `.env.min.example.dev` | Renamed from `.env.min.example`, with the scheduler secret added. |
| `.env.min.example.prod` | New — the deployment minimum: the three no-default secrets, the four localhost-defaulting vars that must name the real host, and `NODE_ENV`. |
| `scripts/init-project.sh` | Dropped the `APP_NAME` rewrite, now that the var is gone. |
| `.gitignore` | Un-ignore both `.env.min.example.*` samples. |

## Regression test added (unit)

`apps/web/src/lib/env.test.ts` (new, 5 cases) — blank optionals read as unset;
non-empty invalid values still rejected; the defaults a blank value previously
produced (`MINIO_REGION`, `MINIO_PATH_STYLE`) are unchanged; and the case that
would have caught this in the first place: the **real `.env.example`** is read
off disk, parsed the way `set -a; source` exports it, and asserted to produce a
valid env. That case fails on the unfixed code.

`apps/api/src/env.test.ts` (+5 cases) — tick-URL derivation from the default
`WEB_BASE_URL`, from a custom one with a trailing slash, and an explicit
override for split deployments; plus the `MINIO_*` values and their fallbacks.

## E2E test added

`apps/web/e2e/fix-zero-env-first-run.spec.ts` — three cases against the running
stack:

1. the unauthenticated `bootstrap.adminExists` query (the first surface a new
   install touches) answers without a server-env error;
2. an authenticated procedure (`settings.getSetupStatus`) answers and reports
   `encryptionKeyReady`, proving the parse produced a usable object rather than
   merely not throwing;
3. `/admin/settings` renders with a blank observability endpoint set.

The stack it runs against is now booted with blank-but-present optionals —
`LANGFUSE_HOST`, `SETUP_TOKEN`, `N8N_WEBHOOK_SECRET` added as `""` to the `env:`
block in `.github/workflows/e2e.yml` — which is exactly what sourcing
`.env.example` produces. That keeps the blank-optional path exercised on every
run instead of only when someone follows the README by hand. All three values
are inert once stripped (Langfuse is stubbed without its keys; the other two are
falsy either way), so nothing else in the suite changes behaviour.

Verified both directions against a local stack: 3 passed on the fixed code, and
with `serverEnv()` reverted to `parse(process.env)` all 3 failed on
`Expected: not 500` / element not found — and the auth fixture itself failed
first with `Auth bypass failed (500)`, since a stack booted that way serves
nothing.

## Manual verification

Two full boots against a local Postgres 16 + pgvector, driving the real
first-run flow over tRPC:

1. **Only the three no-default vars set** — migrations applied, both apps
   booted, `/setup` link printed, admin created, sign-in succeeded, wizard steps
   committed (deployment config, organisation name, `completeOnboarding`),
   `/admin` and `/` served. Connectivity probes degraded correctly with nothing
   configured: storage `ECONNREFUSED`, AI/email/n8n `skipped`.
2. **`.env` copied from `.env.example`** (the `restart.sh` path) — before the
   fix, sign-in 500'd; after, sign-in returned 200, the scheduler logged
   `heartbeat started`, the tick endpoint returned `{"data":{"firedCount":0,…}}`
   with the secret and 401 without it, `job_registry` reported
   `scheduler_worker: healthy`, and email saved in the admin UI was honoured
   (`configured: true`, probe reaching the configured host) instead of being
   swallowed by the stream sink.

## Version

PATCH bump: `2.19.0` → `2.19.1`. `VERSION` and root `package.json` updated.
