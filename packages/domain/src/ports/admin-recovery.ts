import type { Result } from "../result";

export interface RecoverAdminAccessInput {
  email: string;
  password: string;
}

export interface AdminRecoveryOutcome {
  readonly userId: string;
  readonly email: string;
  // False when the recovered address belongs to an ordinary user. The command
  // still restores their password — it just did not restore admin access, and
  // the operator needs to be told so they keep looking for the right address.
  readonly wasAdmin: boolean;
  // True when email/password sign-in had been switched off and this recovery
  // turned it back on. The admin UI that would normally do that is behind the
  // login being recovered, so the operator cannot reach it.
  readonly emailPasswordReEnabled: boolean;
}

/**
 * Break-glass restoration of local password sign-in for one account.
 *
 * Exists because Entra takes precedence over a password: linking a Microsoft
 * identity destroys the account's credential row, so an Entra outage locks out
 * every administrator who has ever signed in through it, and the settings page
 * that could re-enable email/password sits behind that same login.
 *
 * Implemented in adapters over the auth provider — password hashing has to
 * produce exactly the format the provider's sign-in verifies.
 *
 * Deliberately cannot grant administrator rights. A locked-out administrator's
 * user row still carries `isAdmin`, so restoring the password restores their
 * access; a port that could also set the flag would be an escalation tool
 * rather than a recovery one. Creating the very first administrator is
 * `IAdminAccountCreator`'s job.
 */
export interface IAdminRecovery {
  recoverAdminAccess(input: RecoverAdminAccessInput): Promise<Result<AdminRecoveryOutcome>>;
}
