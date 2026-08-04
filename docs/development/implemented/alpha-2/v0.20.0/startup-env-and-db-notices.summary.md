# Implementation summary — quick-start environment + DB notices (v0.20.0)

Diagnosis and reproduction:
[`startup-env-and-db-notices.md`](./startup-env-and-db-notices.md).

## Root cause

**The blocker.** `restart.sh` loads `.env` into its own shell and then execs
`pnpm turbo dev`. Turborepo 2.x defaults to **strict** environment mode, so a
task inherits only a system allowlist — `next dev` started with no
`DATABASE_URL`, no `BETTER_AUTH_SECRET` and no `SETTINGS_ENCRYPTION_KEY`, and
`serverEnv()` threw a `ZodError` on every server-side call. Because the container
is built lazily per request, the client-rendered shells still painted while the
setup wizard, every tRPC procedure and the scheduler tick answered 500 —
`Scheduler tick endpoint returned 500` once a minute in the API log.
`apps/api` was unaffected only because it re-reads `../../.env` through dotenv;
Next.js reads `.env` from the app directory, never the repo root, so the web app
had no equivalent. `[migrate] DATABASE_URL not set — skipping migrations` in the
same log was this cause, not a second one.

**The notices.** Two foreign-key names drizzle derives from the column exceed
Postgres's 63-character identifier limit, so Postgres truncated them (the `42622`
notices) and stored a name that never matched drizzle-kit's snapshot — which made
`drizzle-kit push` drop and re-create both constraints on **every** run
(confirmed by the constraint OIDs changing across one push, and `restart.sh`
pushes on every start). The `42P06`/`42P07`/`00000` notices are drizzle-kit's own
`IF NOT EXISTS` bookkeeping, printed because the driver's default notice handler
writes every NOTICE to the console.

## Fix applied

- **`scripts/with-root-env.sh` (new).** Loads the repo-root `.env` and `exec`s
  the given command; anything already in the environment wins, so an inline
  override or a CI job that sets its own variables is untouched.
- **`apps/web/package.json`.** `dev` and `start` run through the loader, with the
  `${WEB_PORT:-3000}` expansion and the `migrate-if-configured.sh` call moved
  inside it — so the configured port is honoured and the migration step sees the
  database URL it tests for.
- **`turbo.json`.** The `dev` task declares `passThroughEnv: ["*"]`. `dev` is
  `cache: false`, so nothing is hashed and cache correctness is untouched. The
  repo stays on strict mode for `build`, which does bake `NEXT_PUBLIC_*` in and
  must keep hashing them.
- **`packages/adapters/src/db/schema/wayfinder.ts`.** The two overflowing foreign
  keys are declared with explicit names —
  `app_session_schedule_runs_schedule_id_fk` and
  `app_session_approvals_suggested_approver_user_id_fk`.
- **`packages/adapters/drizzle/0041_short_foreign_key_names.sql` (new).** Renames
  the constraints in place, guarded on the truncated name, so it is safe on an
  existing install, a fresh one, and a database already carrying the short name.
  A rename costs no revalidation and never leaves the column unenforced.
- **`packages/adapters/drizzle.config.ts`.** Appends
  `options=-c client_min_messages=warning` to the URL drizzle-kit connects with.
  Warnings and errors still print; notices do not. Application connections are
  untouched.

## Verification

Against a real PostgreSQL 16 + pgvector instance, reproducing the reported flow:

- `turbo run env:probe` with `DATABASE_URL` exported printed `<undefined>` before
  the fix and the URL after — the isolation that identified strict mode.
- `db:migrate` on both an existing and a fresh database, then `db:push`: no
  notices at all, and the two constraint OIDs are now stable across a push
  (`17593`/`17598` before and after) instead of changing every run.
- `./restart.sh` end to end: migrations clean, the first-run setup link printed,
  `POST /api/internal/scheduler/tick` → **200** (`{"data":{"firedCount":0,…}}`),
  an unauthenticated tick → 401, `/setup?token=…` → 200. No `ZodError`, no
  `DATABASE_URL not set`, no `NOTICE` anywhere in the log.
- `./validate.sh` — 22 passed, 0 failed, with `drizzle-kit check` running against
  a reachable database.

## Tests added

- **`apps/web/src/lib/with-root-env.test.ts`** — stages a copy of the real loader
  in a temporary root and spawns it: a file-only variable reaches the child, an
  already-set variable is not overwritten, a missing `.env` is not an error,
  comments/quotes/`export` prefixes parse, an `=` inside a value survives, and
  the command's exit code propagates. Fails before the loader exists.
- **`packages/adapters/src/db/schema/identifier-length.test.ts`** — walks every
  exported Drizzle table through `getTableConfig` and asserts every table,
  column, foreign key, index, unique constraint and check name is ≤ 63
  characters. Failed on both constraints before the rename; catches the next
  over-length identifier at test time rather than as a Postgres notice.
- **`apps/web/e2e/fix-startup-env-and-db-notices.spec.ts`** — asserts the turbo
  `dev` task passes the environment through (real `turbo run dev --dry=json`),
  that the web `dev`/`start` scripts load the repo-root `.env` (real loader, real
  temporary root), and that `/api/internal/scheduler/tick` answers instead of
  500ing. The first two were confirmed red against the unfixed
  `turbo.json`/`package.json` and green after.

## Version

`0.19.2` → `0.20.0`. MINOR rather than the PATCH `/bugfix` prescribes: the change
ships a database migration, and `CLAUDE.md` makes a DB schema change a MINOR.
