import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./index";

// Postgres stores identifiers in a NAMEDATALEN (64) byte field, so anything
// longer than 63 characters is silently truncated with a 42622 notice. A
// truncated constraint name never matches the name drizzle-kit recorded in its
// snapshot, so `drizzle-kit push` drops and re-creates that constraint on every
// run — dropping referential integrity and re-validating the table each time.
const POSTGRES_MAX_IDENTIFIER_LENGTH = 63;

type Identifier = { table: string; kind: string; name: string };

const identifiersOf = (table: PgTable): Identifier[] => {
  const config = getTableConfig(table);
  const named = (kind: string, names: (string | undefined)[]): Identifier[] =>
    names
      .filter((name): name is string => name !== undefined)
      .map((name) => ({ table: config.name, kind, name }));

  return [
    ...named("table", [config.name]),
    ...named(
      "column",
      config.columns.map((column) => column.name),
    ),
    ...named(
      "foreign key",
      config.foreignKeys.map((foreignKey) => foreignKey.getName()),
    ),
    ...named(
      "index",
      config.indexes.map((index) => index.config.name),
    ),
    ...named(
      "unique constraint",
      config.uniqueConstraints.map((constraint) => constraint.getName()),
    ),
    ...named(
      "check",
      config.checks.map((constraint) => constraint.name),
    ),
  ];
};

const tables = Object.values(schema).filter((value): value is PgTable => is(value, PgTable));

describe("Postgres identifier length", () => {
  it("reads the schema tables", () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it("names every table, column and constraint within Postgres's 63-character limit", () => {
    const tooLong = tables
      .flatMap(identifiersOf)
      .filter((identifier) => identifier.name.length > POSTGRES_MAX_IDENTIFIER_LENGTH)
      .map(
        (identifier) =>
          `${identifier.table}: ${identifier.kind} "${identifier.name}" is ${identifier.name.length} characters`,
      );

    expect(tooLong).toEqual([]);
  });
});
