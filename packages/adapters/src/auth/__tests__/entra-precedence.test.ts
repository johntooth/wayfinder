import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "../../db/client";
import { core_accounts, core_sessions } from "../../db/schema/core";
import { applyEntraPrecedence } from "../entra-precedence";

interface RecordedDelete {
  readonly table: unknown;
  readonly condition: SQL;
}

const makeRecordingDatabase = (): { database: Database; deletes: RecordedDelete[] } => {
  const deletes: RecordedDelete[] = [];
  const recorder = {
    delete: (table: unknown) => ({
      where: async (condition: SQL): Promise<void> => {
        deletes.push({ table, condition });
      },
    }),
  };
  return { database: recorder as unknown as Database, deletes };
};

const renderCondition = (condition: SQL): { sql: string; params: unknown[] } => {
  const query = new PgDialect().sqlToQuery(condition);
  return { sql: query.sql, params: query.params };
};

describe("applyEntraPrecedence", () => {
  it("deletes the password credential when a Microsoft account is attached", async () => {
    const { database, deletes } = makeRecordingDatabase();

    await applyEntraPrecedence(database, {
      userId: "3f1b6f7e-0000-4000-8000-000000000001",
      providerId: "microsoft",
    });

    const credentialDelete = deletes.find((entry) => entry.table === core_accounts);
    expect(credentialDelete).toBeDefined();

    const rendered = renderCondition(credentialDelete!.condition);
    expect(rendered.sql).toContain("user_id");
    expect(rendered.sql).toContain("provider_id");
    expect(rendered.params).toEqual(["3f1b6f7e-0000-4000-8000-000000000001", "credential"]);
  });

  it("revokes the linked user's existing sessions", async () => {
    const { database, deletes } = makeRecordingDatabase();

    await applyEntraPrecedence(database, {
      userId: "3f1b6f7e-0000-4000-8000-000000000002",
      providerId: "microsoft",
    });

    const sessionDelete = deletes.find((entry) => entry.table === core_sessions);
    expect(sessionDelete).toBeDefined();

    const rendered = renderCondition(sessionDelete!.condition);
    expect(rendered.sql).toContain("user_id");
    expect(rendered.params).toEqual(["3f1b6f7e-0000-4000-8000-000000000002"]);
  });

  // The password must be gone before the caller issues the post-link session,
  // otherwise the sign-in that triggered the link would be revoked along with
  // the attacker's.
  it("removes the credential before revoking sessions", async () => {
    const { database, deletes } = makeRecordingDatabase();

    await applyEntraPrecedence(database, {
      userId: "3f1b6f7e-0000-4000-8000-000000000003",
      providerId: "microsoft",
    });

    expect(deletes.map((entry) => entry.table)).toEqual([core_accounts, core_sessions]);
  });

  it("ignores a credential sign-up so registration keeps its own password", async () => {
    const { database, deletes } = makeRecordingDatabase();

    await applyEntraPrecedence(database, {
      userId: "3f1b6f7e-0000-4000-8000-000000000004",
      providerId: "credential",
    });

    expect(deletes).toEqual([]);
  });

  it("ignores any other provider", async () => {
    const { database, deletes } = makeRecordingDatabase();

    await applyEntraPrecedence(database, {
      userId: "3f1b6f7e-0000-4000-8000-000000000005",
      providerId: "google",
    });

    expect(deletes).toEqual([]);
  });
});
