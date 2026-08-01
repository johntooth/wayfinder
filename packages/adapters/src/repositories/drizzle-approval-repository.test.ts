import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { recordedSnapshotWhere } from "./drizzle-approval-repository";

const render = (statement: SQL | undefined) => new PgDialect().sqlToQuery(statement!);

describe("recordedSnapshotWhere", () => {
  it("counts only an approval that approved something", () => {
    const { sql, params } = render(recordedSnapshotWhere("sess-1"));
    const text = sql.toLowerCase();

    expect(text).toContain("session_id");
    expect(text).toContain("record_snapshot");
    expect(text).toContain("is not null");
    expect(text).toContain("status");
    expect(params).toContain("sess-1");
    expect(params).toContain("approved");
  });

  it("does not lock on a pending or changes-requested row", () => {
    // A pending row caches the resolved subject in the same column, and a change
    // request has to leave the document editable — that is the whole point of
    // the outcome.
    const { params } = render(recordedSnapshotWhere("sess-1"));

    expect(params).not.toContain("pending");
    expect(params).not.toContain("changes_requested");
  });
});
