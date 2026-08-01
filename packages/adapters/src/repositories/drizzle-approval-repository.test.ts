import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { recordedSnapshotWhere } from "./drizzle-approval-repository";

const render = (statement: SQL | undefined) => new PgDialect().sqlToQuery(statement!);

describe("recordedSnapshotWhere", () => {
  it("counts only a decided approval, so a pending row's cached subject is not a lock", () => {
    const { sql, params } = render(recordedSnapshotWhere("sess-1"));
    const text = sql.toLowerCase();

    expect(text).toContain("session_id");
    expect(text).toContain("record_snapshot");
    expect(text).toContain("is not null");
    // Without the status test, caching the resolved subject on a pending
    // approval would lock the document before anyone had decided anything.
    expect(text).toContain("status");
    expect(params).toContain("sess-1");
    expect(params).toContain("pending");
  });
});
