# Summary — `restart.sh` truncation prompt (0.27.2)

## Symptom

`./restart.sh` stopped on `Do you want to truncate app_notification_log table?`,
and asked again on the next start as if nothing had been applied.

## Root cause

`restart.sh` ran `drizzle-kit push` after `drizzle-kit migrate`. `push` ignores
the migration history: it introspects the live database, diffs it against
`src/db/schema/*.ts`, and prompts before statements that rows can make fail.
Three constructs introspect in a shape that never matches the snapshot, so the
diff never converged:

- `app_notification_log_trigger_resource_recipient_unique` — snapshot holds the
  declared column order, introspection returns table column order
- `kb_document_chunks_embedding_hnsw_idx` — snapshot holds `with: { m: 16 }`,
  introspection returns `{ m: "16" }`
- `kb_document_chunks.tags` — default `'{}'::text[]` introspects as `'{""}'`

So every start dropped and re-added the notification de-duplication constraint
and rebuilt the HNSW index, and — once `app_notification_log` held rows — asked
to truncate it. Nothing was recorded in `drizzle.__drizzle_migrations`, which is
why it recurred.

Reproduced against Postgres 16 + pgvector: 43 migrations applied clean, then
`push` still wanted five statements; two inserted rows produced the prompt
verbatim.

## Fix applied

- **`restart.sh`** — the `db:push` step is gone. Migrations are the only thing
  that alters the schema.
- **`packages/adapters/scripts/check-schema-drift.mjs`** (new, `pnpm db:drift`) —
  answers what push was there for by generating against the committed snapshot
  in a scratch folder and reporting any SQL that comes out. No database, no
  prompts, and it goes quiet once a migration exists. `restart.sh` warns and
  keeps starting; `validate.sh` fails.
- **`packages/adapters/package.json`** — `db:push` removed; `db:drift` added
  (also on the root manifest).
- **`packages/adapters/src/db/migration-safety.test.ts`** (new) — every
  migration that destroys rows or that existing rows can make fail must declare
  `-- data-impact: preserved | destructive, approved | blocking, approved — <reason>`.
- **Eight existing migrations** annotated with accurate declarations (0017,
  0023, 0025, 0027, 0028, 0029, 0030, 0031). Comment-only edits: the migrator
  replays from `_journal.json`'s `when`, and the file hash it stores is recorded,
  never compared — verified by re-running `db:migrate` against an already-migrated
  database (43 rows before and after) and `db:check`.
- **Docs** — destructive-migration policy and the no-push rule in
  `docs/guides/database-conventions.md`; one architecture rule line in
  `CLAUDE.md` and `AGENTS.md` so every skill inherits it.

## Regression tests added

| Guard | Proven by |
| --- | --- |
| `migration-safety.test.ts` | Failed on the 8 undeclared migrations, passed once declared |
| `validate.sh` §22 schema drift | Detected an added column, went quiet when reverted |
| `validate.sh` §23 no `drizzle-kit push` | Fired on a re-added `db:push` line, clean without it |

## E2E test

None. The defect lives in a start-up script and in migration files — no UI or
API surface to drive. All three guards run on every `./validate.sh`.

## Known follow-up

`0029_audit_chain_and_legal_holds.sql` adds `core_audit_log.hash` as `NOT NULL`
with no default, so it can only apply while the audit log is empty. It is left
as-is (applied migrations are never edited) and now declares
`blocking, approved` with the backfill a populated database would need. The new
test is what stops the next one being written.

## Version

PATCH: 0.27.1 → 0.27.2. No schema change.
