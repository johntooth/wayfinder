import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildFindByIdsStatement, normaliseName } from "./drizzle-user-repository";

// Batch hydration replaces the per-participant N+1 (scaling wall #6). A live DB
// proves the rows come back; here we pin the generated SQL to an IN filter so it
// can never regress to one query per id.
describe("buildFindByIdsStatement", () => {
  it("filters with a single IN over the supplied ids", () => {
    const statement = buildFindByIdsStatement(["a", "b", "c"]);
    const { sql, params } = new PgDialect().sqlToQuery(statement);
    const text = sql.toLowerCase();

    expect(text).toContain("where");
    expect(text).toContain(" in ");
    expect(params).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });
});

// A sign-up that left the name field empty stores "" via Better Auth's own
// adapter. Callers must see that as "no name set", not as a display name.
describe("normaliseName", () => {
  it("keeps a real name", () => {
    expect(normaliseName("Ada Lovelace")).toBe("Ada Lovelace");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseName("  Ada Lovelace  ")).toBe("Ada Lovelace");
  });

  it("collapses an empty or whitespace-only name to null", () => {
    expect(normaliseName("")).toBeNull();
    expect(normaliseName("   ")).toBeNull();
  });

  it("passes null through", () => {
    expect(normaliseName(null)).toBeNull();
  });
});
