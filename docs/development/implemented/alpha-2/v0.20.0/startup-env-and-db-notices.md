# Bug Fix — The quick start boots a web app with no environment, and the DB run is full of notices

## Symptom

Following the README quick start on `release/alpha-2`:

```
git clone --branch release/alpha-2 https://github.com/rbrasier/wayfinder
cd wayfinder
docker compose up -d
./restart.sh
```

`restart.sh` completes — secrets are generated, migrations apply — but the web
app answers `500` on every server-side call. The API's scheduler heartbeat makes
it obvious once a minute:

```
@wayfinder/web:dev: [migrate] DATABASE_URL not set — skipping migrations.
…
@wayfinder/web:dev: Error [ZodError]: [
@wayfinder/web:dev:   { "code": "invalid_type", "expected": "string", "received": "undefined",
@wayfinder/web:dev:     "path": [ "DATABASE_URL" ], "message": "Required" },
@wayfinder/web:dev:   { … "path": [ "BETTER_AUTH_SECRET" ] … },
@wayfinder/web:dev:   { … "path": [ "SETTINGS_ENCRYPTION_KEY" ] … } ]
@wayfinder/web:dev:     at serverEnv (src/lib/env.ts:171:28)
@wayfinder/web:dev:     at build (src/lib/container.ts:218:24)
@wayfinder/web:dev:  POST /api/internal/scheduler/tick 500 in 5789ms
@wayfinder/api:dev: [19:54:27] ERROR: Scheduler tick failed.
@wayfinder/api:dev:     reason: "Scheduler tick endpoint returned 500. "
```

Severity: **blocker**. `serverEnv()` is called lazily when the container is
built, so the client-rendered `/login` and `/setup` shells still paint — but the
setup wizard, every tRPC procedure, every Better Auth route and the scheduler
tick all throw. A fresh clone cannot complete first-run setup.

Alongside it, both database commands print Postgres `NOTICE` payloads that look
like failures:

```
{ severity: 'NOTICE', code: '42P06', message: 'schema "drizzle" already exists, skipping' … }
{ severity: 'NOTICE', code: '42P07', message: 'relation "__drizzle_migrations" already exists, skipping' … }
{ severity: 'NOTICE', code: '42622',
  message: 'identifier "app_session_schedule_runs_schedule_id_app_session_schedules_id_fk" will be
            truncated to "app_session_schedule_runs_schedule_id_app_session_schedules_id_"' … }
{ severity: 'NOTICE', code: '42622',
  message: 'identifier "app_session_approvals_suggested_approver_user_id_core_users_id_fk" will be
            truncated to "app_session_approvals_suggested_approver_user_id_core_users_id_"' … }
```

## Reproduction

Both defects reproduce from a clean clone with nothing but Docker (verified here
against a real PostgreSQL 16 + pgvector instance on `:5433`, the port
`.env.example` points `DATABASE_URL` at).

1. `cp .env.example .env`, generate the three secrets exactly as `restart.sh`
   does, `createdb wayfinder`.
2. `set -a; source .env; set +a` — the shell now holds every variable.
3. `pnpm turbo dev` (what `restart.sh` execs). The web task cannot see any of
   them; `serverEnv()` throws on the first server-side call.
4. `pnpm --filter @rbrasier/adapters db:migrate` twice, then `db:push` — the
   four notices above appear, and the two `42622` ones appear on *every* push.

## Root cause (verified)

### 1. Turborepo 2.x strict env mode strips the environment from every task

`restart.sh` loads `.env` into its own shell and then hands off:

```bash
if [ -f .env ]; then set -a; source .env; set +a; fi
…
exec pnpm turbo dev
```

That hand-off is where the environment is lost. Turborepo 2.0 made **strict**
the default environment mode: a task receives only a small system allowlist plus
whatever the task declares in `env` / `passThroughEnv` / `globalEnv`. `turbo.json`
declares none of those, so `next dev` starts with no `DATABASE_URL`, no
`BETTER_AUTH_SECRET`, no `SETTINGS_ENCRYPTION_KEY` — and no `WEB_PORT` either,
so `next dev -p ${WEB_PORT:-3000}` silently ignores a configured port.

Confirmed two ways. What turbo itself reports for the task:

```
$ turbo run dev --dry=json
global envMode: strict
{ "task": "@wayfinder/web#dev", "envMode": "strict",
  "env": { "specified": { "env": [], "passThroughEnv": null }, … "passthrough": null } }
```

And an end-to-end probe — a temporary `env:probe` script that prints one
variable, run with that variable exported:

```
$ DATABASE_URL=postgresql://probe@localhost:5433/x turbo run env:probe --filter=@wayfinder/web
@wayfinder/web:env:probe: PROBE DATABASE_URL=<undefined>
```

The same probe under `envMode: "loose"` prints the URL, which isolates the cause
to the env mode and nothing else.

`apps/api` escapes only by accident of its own design: `src/index.ts` starts with
`import "dotenv/config"` and its dev script sets `DOTENV_CONFIG_PATH=../../.env`,
so the API re-reads the file itself and never depends on what turbo passes down.
`apps/web` has no equivalent — Next.js loads `.env` files from the **app**
directory (`apps/web/.env`), never from the repo root — so the root `.env` that
`restart.sh` writes reaches the API and not the web app.

`[migrate] DATABASE_URL not set — skipping migrations.` in the same log is this
same cause, not a second one: `scripts/migrate-if-configured.sh` runs inside the
web task and tests a variable that strict mode has already removed. It is why
the message is a lie on a machine whose `.env` is correct.

This also explains why the failure survived review: every check in `validate.sh`
(typecheck, lint, test, `db:check`) runs against variables the developer's shell
already holds, or with no environment at all. Nothing exercises the
`source .env` → `turbo` → `next` path that the README documents.

### 2. Two foreign-key constraint names exceed Postgres's 63-character limit

Postgres identifiers are capped at `NAMEDATALEN - 1` = 63 characters. Drizzle
derives a foreign-key name from `<table>_<column>_<foreign table>_<foreign column>_fk`,
and two of them overflow:

| Generated name | Length |
|---|---|
| `app_session_schedule_runs_schedule_id_app_session_schedules_id_fk` | 65 |
| `app_session_approvals_suggested_approver_user_id_core_users_id_fk` | 65 |

They are the only two over-length identifiers in the entire migration set
(`grep -rhoE '"[a-z0-9_]{64,}"' packages/adapters/drizzle/*.sql` returns exactly
these). Postgres truncates each to 63 characters, emits the `42622` notice, and
stores the truncated name.

The notice is the harmless half. The damaging half is that the name drizzle-kit
believes is in the database (the full 66/65-character one, recorded in
`drizzle/meta/*_snapshot.json`) never matches the name actually there, so
**`db:push` drops and re-creates both constraints on every single run**. Proven
by watching the constraint OIDs across one push:

```
BEFORE:      app_session_approvals_suggested_approver_user_id_core_users_id_|17584
             app_session_schedule_runs_schedule_id_app_session_schedules_id_|17579
AFTER PUSH:  app_session_approvals_suggested_approver_user_id_core_users_id_|17598
             app_session_schedule_runs_schedule_id_app_session_schedules_id_|17593
```

New OIDs mean new constraints. `restart.sh` runs `db:push` on every start, so
every start drops referential integrity on those two columns and re-validates
both tables to re-add them — cheap now, not cheap on a real dataset.

### 3. drizzle-kit prints every Postgres NOTICE, including its own bookkeeping

`42P06` (`schema "drizzle" already exists`) and `42P07` (`relation
"__drizzle_migrations" already exists`) come from drizzle-kit's own
`CREATE … IF NOT EXISTS` bookkeeping on every run after the first; a fresh
database additionally prints `00000` (`trigger "core_audit_log_no_mutate" …
does not exist, skipping`) from `0031_audit_append_only_enforcement.sql`.

None of them indicates a problem — `IF NOT EXISTS` doing its job is the notice.
They are printed because the `postgres` driver's default `onnotice` handler
writes to the console and drizzle-kit does not override it. There is no
drizzle-kit option for this, but the threshold is a server-side setting
(`client_min_messages`) that can be sent as a connection parameter, so it can be
raised for the migration connection alone.

## Fix plan

### Blocker — get the environment to the web app

1. **`scripts/with-root-env.sh` (new).** Load the repo-root `.env` into the
   environment and `exec` the given command. Anything already set in the
   environment wins, so `DATABASE_URL=… pnpm dev` still overrides the file. This
   makes the web app self-sufficient in exactly the way `apps/api` already is,
   independent of the runner — `turbo dev`, `pnpm dev` inside `apps/web`, or a
   bare `next start` all behave the same.
2. **`apps/web/package.json`.** Run `dev` and `start` through the wrapper, with
   both the `${WEB_PORT:-3000}` expansion and the existing
   `migrate-if-configured.sh` call moved inside it — so the port is honoured and
   the migration step stops reporting `DATABASE_URL not set` on a machine whose
   `.env` is correct. `scripts/migrate-if-configured.sh` itself needs no change:
   it is only ever invoked from these two scripts, and it now runs inside the
   loader.
3. **`turbo.json`.** Give the `dev` task `passThroughEnv: ["*"]`. `dev` is
   `cache: false`, so nothing is hashed and cache correctness is untouched; this
   just restores the pre-2.0 expectation that a task inherits the developer's
   shell, and stops the next task added here from falling into the same hole.

Deliberately **not** done: switching the whole repo to `envMode: "loose"`. That
would also stop `build` from hashing environment variables it bakes in
(`NEXT_PUBLIC_*`), trading this bug for stale-cache bugs.

### DB notices

5. **`packages/adapters/src/db/schema/wayfinder.ts`.** Replace the two inline
   `.references()` calls with explicit `foreignKey({ …, name })` constraints
   named `app_session_schedule_runs_schedule_id_fk` (40 chars) and
   `app_session_approvals_suggested_approver_user_id_fk` (51 chars).
6. **New migration.** Rename the existing constraints in place — guarded by
   `pg_constraint` lookups so it is a no-op on a database that already has the
   short name, and safe on both an existing install (truncated name present) and
   a fresh one. A rename, not a drop/add: no revalidation, no window without the
   constraint.
7. **`packages/adapters/drizzle.config.ts`.** Append
   `options=-c client_min_messages=warning` to the URL drizzle-kit connects with,
   so migrate/push report warnings and errors and stay quiet about notices. The
   application's own connections are untouched.

### Regression tests

- **`apps/web/src/lib/with-root-env.test.ts`** — stages a copy of the real loader
  in a temporary root and spawns it: a variable from the file reaches the child,
  an already-set variable is not overwritten, a missing `.env` is not an error,
  quoted and `export`-prefixed lines parse, an `=` inside a value survives, and
  the command's exit code propagates.
- **`packages/adapters/src/db/schema/identifier-length.test.ts`** — walks every
  exported Drizzle table via `getTableConfig` and asserts every table, column,
  foreign key, index, unique constraint and check name is ≤ 63 characters. This
  is the guard that fails today for both constraints and catches the next one.
- **`apps/web/e2e/fix-startup-env-and-db-notices.spec.ts`** — asserts the two
  startup contracts against the real turbo binary and the real loader script,
  then drives `/api/internal/scheduler/tick` (the endpoint in the report) and
  asserts it no longer answers 500 with a `serverEnv()` `ZodError`.

## Version

`0.19.2` → `0.20.0`. `/bugfix` prescribes a PATCH, but this ships a database
migration and `CLAUDE.md`'s versioning rule makes a DB schema change a MINOR.
