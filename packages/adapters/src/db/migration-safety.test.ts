import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A migration runs against databases that already hold data, so anything that
// drops rows — or that the existing rows can make fail — has to say what it does
// to them. `preserved` is the expectation; the two `approved` kinds are the
// deliberate exceptions, spelled out where a reviewer sees them in the diff.
const DATA_IMPACT_DECLARATION =
  /^--\s*data-impact:\s*(preserved|destructive, approved|blocking, approved)\s*[—-]\s*(\S.*)$/m;

const ROW_AFFECTING_PATTERNS: { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
  { label: "column type change", pattern: /\bALTER\s+COLUMN\b[\s\S]*\b(SET\s+DATA\s+)?TYPE\b/i },
  { label: "SET NOT NULL", pattern: /\bSET\s+NOT\s+NULL\b/i },
  { label: "ADD CONSTRAINT … UNIQUE", pattern: /\bADD\s+CONSTRAINT\b[\s\S]*\bUNIQUE\b/i },
  { label: "CREATE UNIQUE INDEX", pattern: /\bCREATE\s+UNIQUE\s+INDEX\b/i },
  { label: "DELETE FROM", pattern: /\bDELETE\s+FROM\b/i },
];

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

const withoutComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

// Drizzle separates statements with its own marker rather than a bare semicolon,
// which is what keeps a `DO $$ … $$` body — full of semicolons — in one piece.
const statementsOf = (sql: string): string[] =>
  sql
    .split("--> statement-breakpoint")
    .map(withoutComments)
    .flatMap((chunk) => (chunk.includes("$$") ? [chunk] : chunk.split(";")))
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

const addsNotNullColumnWithoutDefault = (statement: string): boolean =>
  /\bADD\s+COLUMN\b/i.test(statement) &&
  /\bNOT\s+NULL\b/i.test(statement) &&
  !/\bDEFAULT\b/i.test(statement);

const rowAffectingReasons = (sql: string): string[] => {
  const reasons = statementsOf(sql).flatMap((statement) => {
    const matched = ROW_AFFECTING_PATTERNS.filter(({ pattern }) => pattern.test(statement)).map(
      ({ label }) => label,
    );
    if (addsNotNullColumnWithoutDefault(statement)) {
      return [...matched, "ADD COLUMN … NOT NULL with no default"];
    }
    return matched;
  });

  return [...new Set(reasons)];
};

const migrationFiles = readdirSync(migrationsFolder)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort()
  .map((fileName) => ({ fileName, sql: readFileSync(join(migrationsFolder, fileName), "utf8") }));

describe("migration data safety", () => {
  it("reads the generated migrations", () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  it("declares the data impact of every migration that drops or blocks rows", () => {
    const undeclared = migrationFiles
      .map((migration) => ({ ...migration, reasons: rowAffectingReasons(migration.sql) }))
      .filter((migration) => migration.reasons.length > 0)
      .filter((migration) => !DATA_IMPACT_DECLARATION.test(migration.sql))
      .map(
        (migration) =>
          `${migration.fileName} contains ${migration.reasons.join(", ")} but declares no ` +
          `"-- data-impact: preserved — …", "-- data-impact: destructive, approved — …" or ` +
          `"-- data-impact: blocking, approved — …" line`,
      );

    expect(undeclared).toEqual([]);
  });

  it("gives a reason with every data-impact declaration", () => {
    const unreasoned = migrationFiles
      .filter((migration) => /^--\s*data-impact:/m.test(migration.sql))
      .filter((migration) => !DATA_IMPACT_DECLARATION.test(migration.sql))
      .map(
        (migration) =>
          `${migration.fileName} declares a data impact that is none of "preserved — <how>", ` +
          `"destructive, approved — <why>" or "blocking, approved — <why>"`,
      );

    expect(unreasoned).toEqual([]);
  });
});
