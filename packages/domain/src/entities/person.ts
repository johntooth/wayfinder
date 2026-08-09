// A person surfaced by the federated people directory. `source` records which
// backing system produced the record so the UI can label it and the federation
// layer can de-duplicate by email across sources.

// `user` is an existing Wayfinder account. It ranks above the external
// directories because it is the only source whose people can actually act on
// what they are sent — an approver with no account cannot decide until one
// exists (ADR-018, step-approvals PRD §12).
export type PersonSource = "user" | "entra" | "hr" | "email";

export interface Person {
  readonly source: PersonSource;
  // The backing directory's own identifier (Entra object id, HR row id), or null
  // for a free-typed email with no matching record.
  readonly directoryId: string | null;
  // The matched `core_users` id when the person already has an account, else null.
  readonly userId: string | null;
  readonly displayName: string | null;
  readonly email: string;
  readonly jobTitle: string | null;
  readonly department: string | null;
}
