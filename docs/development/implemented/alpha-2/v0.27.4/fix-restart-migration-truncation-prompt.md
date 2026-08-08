# Fix — `restart.sh` asks to truncate a table on every start

## Symptom

Running `./restart.sh` sometimes stops on an interactive prompt:

```
· You're about to add app_notification_log_trigger_resource_recipient_unique unique
  constraint to the table, which contains 2 items. If this statement fails, you will
  receive an error from the database. Do you want to truncate app_notification_log table?
```

Answering it does not settle anything — the same prompt (or the same error, when
the terminal is not a TTY) comes back on the next start, as if nothing had been
applied.

## Reproduction

Verified end to end against a real Postgres 16 with pgvector:

1. Create an empty database and run `pnpm --filter @rbrasier/adapters db:migrate`.
   All 43 migrations apply cleanly.
2. Run `db:push` (what `restart.sh` does next). On the empty database it silently
   executes five statements.
3. Insert two rows into `app_notification_log` and run `db:push` again — the
   truncate prompt above appears.
4. Run it again after answering. The same statements come back.

## Root cause

`restart.sh` ran `drizzle-kit push` immediately after `drizzle-kit migrate`:

```sh
echo "→ verifying schema is in sync (drizzle-kit push)"
pnpm --filter "$ADAPTERS_PKG" db:push || { … }
```

`push` does not read the migration history. It introspects the live database,
diffs that against `src/db/schema/*.ts`, and executes whatever closes the gap —
prompting first when a statement could lose or reject rows.

For this schema that diff can never reach zero. Three constructs come back from
drizzle-kit's introspection in a form that does not match the snapshot it
compares against:

| Object | Snapshot (`meta/0042_snapshot.json`) | Introspected from Postgres | Push emits, every run |
| --- | --- | --- | --- |
| `app_notification_log_trigger_resource_recipient_unique` | declared column order `trigger, resource_id, recipient_email` | table column order `recipient_email, trigger, resource_id` | `DROP CONSTRAINT` + `ADD CONSTRAINT … UNIQUE` |
| `kb_document_chunks_embedding_hnsw_idx` | `with: { m: 16, ef_construction: 64 }` (numbers) | `with: { m: "16", ef_construction: "64" }` (strings) | `DROP INDEX` + `CREATE INDEX … USING hnsw` |
| `kb_document_chunks.tags` default | `'{}'::text[]` | `'{""}'` | `ALTER COLUMN … SET DEFAULT` |

The comparison is positional for constraint columns and strict for index
options, so each of these differs on every single run regardless of what the
previous run did. Two consequences follow:

1. **The prompt is unavoidable and recurring.** Re-adding a unique constraint to
   a table that holds rows is exactly the case drizzle-kit asks about, and
   `app_notification_log` accumulates rows in normal use. Because the diff never
   converges, the question returns on every start — the "as if it hasn't been
   applied" symptom. `push` writes nothing to `drizzle.__drizzle_migrations`, so
   from the migration history's point of view nothing ever was applied.
2. **Every start briefly drops real guarantees.** The unique constraint that
   de-duplicates notification sends is dropped and re-added, and the HNSW index
   backing semantic search is dropped and rebuilt from scratch — cheap on an
   empty developer database, expensive and disruptive on a populated one.

The related over-length foreign key names fixed in `0041` were the same class of
defect. That fix removed one source of permanent drift; it could not remove the
three above, which come from drizzle-kit's introspection rather than from
anything the schema controls.

## Fix plan

### 1. Stop running `push`

Remove the `db:push` step from `restart.sh`, and remove the `db:push` script from
`packages/adapters/package.json` so no one reaches for it by habit. Generated
migrations become the only thing that alters the schema — which is what
`docs/guides/database-conventions.md` already says, and what production has
always done (`runMigrations()` in the container never had a push step).

### 2. Replace it with a drift check that converges

`push` was there to answer a real question: *has someone edited `schema/*.ts`
without generating a migration?* Answer it without touching the database.

`packages/adapters/scripts/check-schema-drift.mjs` seeds a scratch folder with
the committed `drizzle/meta`, runs `drizzle-kit generate` into it, and reports
whatever SQL that produces. Comparing the schema against its own snapshot avoids
the introspection mismatches entirely, so the check is silent when the tree is
clean and converges as soon as a migration is generated. It needs no
`DATABASE_URL`, so `validate.sh` can run it in CI where the current
`drizzle-kit check` section skips.

- `restart.sh` — warn and keep starting. Mid-change iteration stays usable.
- `validate.sh` — fail. Drift cannot reach a pull request.

### 3. Make the data-safety rule enforceable

The standing rule is that a migration must carry its data across unless the loss
is deliberate. Nothing checked it, so `restart.sh` was free to offer truncation
as a routine answer.

`packages/adapters/src/db/migration-safety.test.ts` (same pattern as
`identifier-length.test.ts`) scans every file in `drizzle/`, strips comments, and
looks for statements that destroy rows (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`,
`SET DATA TYPE`) or that fail against existing rows (`SET NOT NULL`, `ADD COLUMN
… NOT NULL` with no default, `ADD CONSTRAINT … UNIQUE`, `CREATE UNIQUE INDEX`).
Any file containing one must declare what it does to existing rows:

```sql
-- data-impact: preserved — <how existing rows survive>
-- data-impact: destructive, approved — <why the loss is intended>
```

`preserved` is the default expectation; `destructive, approved` is the
"unless otherwise specified" escape hatch, spelled out in the diff where a
reviewer sees it. A file with neither fails `pnpm test`.

The twelve existing migrations that contain such statements get accurate
declarations. Adding a comment does not re-run an applied migration: the
migrator decides what to apply from `_journal.json`'s `when` timestamp
(`pg-core/dialect.js` compares `lastDbMigration.created_at < migration.folderMillis`),
and the file hash it stores is recorded, never compared.

### 4. Document it

- `docs/guides/database-conventions.md` — a destructive-migration policy, the
  declaration format, and why `push` is not used.
- `CLAUDE.md` — one architecture rule line, so every skill that writes a
  migration inherits it.

## Regression guards

| Guard | Catches |
| --- | --- |
| `validate.sh` — "restart.sh does not run drizzle-kit push" | The step being reintroduced |
| `validate.sh` — schema drift section | `schema/*.ts` edited with no migration |
| `migration-safety.test.ts` | A migration that drops or blocks rows without declaring it |

No Playwright e2e test accompanies this fix: the defect lives in a developer
start-up script and the migration files, neither of which has a UI or API
surface to drive. The guards above run on every `./validate.sh`.
