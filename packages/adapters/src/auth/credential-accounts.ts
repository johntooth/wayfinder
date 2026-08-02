import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_accounts } from "../db/schema/core";
import type { CredentialAccountProbe } from "../health/connectivity-probes";

// Email + password can be enabled with nobody able to use it — an install whose
// accounts all arrived through Entra or a certificate has no credential rows at
// all. The sign-in probe asks this to tell "on" apart from "usable".
export const createCredentialAccountProbe = (db: Database): CredentialAccountProbe => ({
  async countAccountsWithPassword(): Promise<number> {
    // Existence, not a total: one account with a password is the whole question,
    // so the query stops there rather than counting every row.
    const rows = await db
      .select({ id: core_accounts.id })
      .from(core_accounts)
      .where(and(eq(core_accounts.provider_id, "credential"), isNotNull(core_accounts.password)))
      .limit(1);
    return rows.length;
  },
});
