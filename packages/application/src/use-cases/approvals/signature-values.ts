import type { IApprovalRepository, TemplateField } from "@rbrasier/domain";
import { ATTESTATION_TEXT_KEY, SIGNATURE_FIELD_KEY, SUBJECT_NODE_ID_KEY } from "./approval-record-keys";

// Every signature slot on a step's template, mapped to the attestation block
// frozen into whichever approval filled it — empty for a slot nobody has decided.
//
// Read by both paths that re-render a document: the decision itself, and any
// later manual edit. An edit that rebuilt the render data without these would
// silently blank an approver's signature, so this is not an optimisation but
// the thing that keeps a signed document signed.
//
// The blocks are read from the records, never recomputed. A decided approval's
// record is frozen (ADR-045 §6); re-deriving one would re-sign on the signer's
// behalf if anything bound into the hash had changed since.
export const signatureValuesForStep = async (
  approvals: IApprovalRepository,
  sessionId: string,
  subjectNodeId: string,
  fields: readonly TemplateField[],
): Promise<Record<string, string>> => {
  const slots = fields.filter((field) => field.type === "signature").map((field) => field.key);
  if (slots.length === 0) return {};

  const values: Record<string, string> = {};
  for (const slot of slots) values[slot] = "";

  const sessionApprovals = await approvals.listBySession(sessionId);
  if (sessionApprovals.error) return values;

  for (const approval of sessionApprovals.data) {
    if (approval.status === "pending") continue;
    if (readString(approval.recordSnapshot, SUBJECT_NODE_ID_KEY) !== subjectNodeId) continue;

    const slot = readString(approval.recordSnapshot, SIGNATURE_FIELD_KEY);
    const text = readString(approval.recordSnapshot, ATTESTATION_TEXT_KEY);
    if (slot && text && slot in values) values[slot] = text;
  }

  return values;
};

const readString = (snapshot: Record<string, unknown> | null, key: string): string | null => {
  const value = snapshot?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};
