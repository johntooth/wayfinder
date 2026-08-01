// The value written into a document's signature slot when an approval is decided
// (ADR-043 §3). Ordinary text in ordinary runs, so it renders identically in
// every .docx reader — Word 2007 through Word Online, Google Docs, LibreOffice
// and Pages — rather than degrading to an empty box the way a Word signature
// line does.
//
// This is an *advanced* electronic signature, not a qualified one: identity is
// bound by authenticated sign-in and content by a hash chained into the
// append-only audit log (ADR-033). Nothing here may be described to users as a
// qualified or PKI signature.

import type { ApprovalStatus } from "./approval";
import { canonicalAuditString, type Sha256Hex } from "./audit-hash";

export interface AttestationInput {
  readonly approvalId: string;
  readonly sessionId: string;
  readonly nodeId: string;
  readonly approverName: string | null;
  readonly approverEmail: string | null;
  readonly approverRole: string | null;
  readonly decision: ApprovalStatus;
  readonly decidedAt: Date;
  readonly comment: string | null;
  readonly subjectDescription: string | null;
}

export interface AttestationBlock {
  readonly text: string;
  // The human-quotable handle for finding the record. A lookup key, never a
  // security primitive — any verification surface must resolve on the full hash.
  readonly verificationCode: string;
}

const DECISION_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
};

// Exhaustive by construction: adding an ApprovalStatus without a label here is a
// compile error, so no rendering site can silently fall through to a blank.
export const decisionLabel = (decision: ApprovalStatus): string => DECISION_LABEL[decision];

const pad = (value: number): string => String(value).padStart(2, "0");

// DD-MM-YYYY HH:MM UTC — the same date shape the (date) field type uses, with
// the zone named so a reader never has to guess whose clock it was.
const formatDecidedAt = (decidedAt: Date): string =>
  `${pad(decidedAt.getUTCDate())}-${pad(decidedAt.getUTCMonth() + 1)}-${decidedAt.getUTCFullYear()} ${pad(decidedAt.getUTCHours())}:${pad(decidedAt.getUTCMinutes())} UTC`;

// Reuses `canonicalAuditString` rather than serialising independently, so the
// code in the document and the hash in the audit chain can never drift apart.
const canonicalAttestation = (input: AttestationInput): string =>
  canonicalAuditString({
    actorId: input.approverEmail,
    action: "approval.decided",
    resourceType: "approval",
    resourceId: input.approvalId,
    createdAt: input.decidedAt,
    sequence: 0,
    metadata: {
      sessionId: input.sessionId,
      nodeId: input.nodeId,
      approverName: input.approverName,
      approverRole: input.approverRole,
      decision: input.decision,
      comment: input.comment,
      subjectDescription: input.subjectDescription,
    },
  });

export const attestationVerificationCode = (
  input: AttestationInput,
  sha256Hex: Sha256Hex,
): string => sha256Hex(canonicalAttestation(input)).slice(0, 12).toUpperCase();

export const buildAttestationBlock = (
  input: AttestationInput,
  sha256Hex: Sha256Hex,
): AttestationBlock => {
  const verificationCode = attestationVerificationCode(input, sha256Hex);
  const identity = input.approverName
    ? `${input.approverName}${input.approverEmail ? ` (${input.approverEmail})` : ""}`
    : (input.approverEmail ?? "Unknown approver");

  // "Approved by" is only true of an approval. A rejection carrying that label
  // would misread at a glance, which is the one thing an attestation must not do.
  const byLabel = input.decision === "approved" ? "Approved by:  " : "Decided by:   ";

  const lines = [`${byLabel} ${identity}`];
  if (input.approverRole) lines.push(`Role:          ${input.approverRole}`);
  lines.push(`Decision:      ${decisionLabel(input.decision)}`);
  lines.push(`Date:          ${formatDecidedAt(input.decidedAt)}`);
  if (input.comment) lines.push(`Comment:       ${input.comment}`);
  lines.push(`Verification:  WF-${verificationCode}`);

  return { text: lines.join("\n"), verificationCode };
};
