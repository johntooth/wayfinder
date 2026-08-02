import type {
  ApprovalSubject,
  ChangesRequestedTarget,
  PriorStepField,
} from "@rbrasier/domain";

// Maps the approval modal's subject / signature / routing fields to the
// persisted `ApprovalNodeConfig` jsonb, and back. Every control has an "absent"
// value that matches the runtime default, so an approval node authored before
// this feature opens on exactly the behaviour it already had.

export type ApprovalSubjectKind = "step" | "custom";

// A step earlier in the flow, as the canvas knows it. `type` drives the
// return-target list, which only offers steps an operator can actually change.
export interface PriorStep {
  nodeId: string;
  stepLabel: string;
  type: "conversational" | "auto" | "scheduled" | "approval" | "mcp";
}

// The empty string is the "use the default" sentinel for both dropdowns: an
// unset subject means the last completed step, an unset return target means the
// nearest editable one. Encoding that as "" keeps a native <select> honest,
// since its value is always a string.
export const DEFAULT_CHOICE = "";

export const encodeApprovalSubject = (
  subject: ApprovalSubject | undefined,
): { kind: ApprovalSubjectKind; nodeId: string; instruction: string } => {
  if (subject?.kind === "custom") {
    return { kind: "custom", nodeId: DEFAULT_CHOICE, instruction: subject.instruction };
  }
  return { kind: "step", nodeId: subject?.nodeId ?? DEFAULT_CHOICE, instruction: "" };
};

export const decodeApprovalSubject = (values: {
  kind: ApprovalSubjectKind;
  nodeId: string;
  instruction: string;
}): ApprovalSubject | undefined => {
  if (values.kind === "custom") {
    const instruction = values.instruction.trim();
    // An empty instruction is not a subject, so it stores nothing and falls back
    // to the last completed step rather than asking the model to summarise "".
    return instruction ? { kind: "custom", instruction } : undefined;
  }
  return values.nodeId ? { kind: "step", nodeId: values.nodeId } : undefined;
};

// The modal asks one question — "what is being approved?" — whose answers are
// the default, any earlier step, or a subject the author describes. A native
// <select> value is always a string, so the described case needs a sentinel
// that cannot collide with a node id.
export const CUSTOM_SUBJECT_CHOICE = "__describe__";

export const approvalSubjectChoice = (values: {
  kind: ApprovalSubjectKind;
  nodeId: string;
}): string => (values.kind === "custom" ? CUSTOM_SUBJECT_CHOICE : values.nodeId);

export const approvalSubjectFromChoice = (
  choice: string,
): { kind: ApprovalSubjectKind; nodeId: string } =>
  choice === CUSTOM_SUBJECT_CHOICE
    ? { kind: "custom", nodeId: DEFAULT_CHOICE }
    : { kind: "step", nodeId: choice };

export const encodeChangesRequestedTarget = (
  target: ChangesRequestedTarget | undefined,
): string => (target?.kind === "step" ? target.nodeId : DEFAULT_CHOICE);

export const decodeChangesRequestedTarget = (
  nodeId: string,
): ChangesRequestedTarget | undefined => (nodeId ? { kind: "step", nodeId } : undefined);

// Only a conversational step gives the operator something to change, so those
// are the only ones offered as a return target (ADR-044 §2).
export const editableReturnSteps = (priorSteps: PriorStep[]): PriorStep[] =>
  priorSteps.filter((step) => step.type === "conversational");

// The signature slots declared by the subject step's template. Read from the
// prior-step field list, which carries the raw template fields — `nodeFieldSet`
// filters signatures out on purpose, and this is the one place that needs them.
export const signatureSlotsFor = (
  priorStepFields: PriorStepField[],
  subjectNodeId: string,
): Array<{ key: string; label: string }> => {
  if (!subjectNodeId) return [];
  const seen = new Set<string>();
  const slots: Array<{ key: string; label: string }> = [];
  for (const entry of priorStepFields) {
    if (entry.nodeId !== subjectNodeId) continue;
    if (entry.field.type !== "signature") continue;
    if (seen.has(entry.field.key)) continue;
    seen.add(entry.field.key);
    slots.push({ key: entry.field.key, label: entry.field.label });
  }
  return slots;
};

export type SignatureSlotControl =
  // The template declares none, so the approval simply records no signature.
  | { mode: "none" }
  // Exactly one: there is no choice to make, so it binds without a control.
  | { mode: "auto"; key: string }
  // Two or more: the author must say which slot this step signs.
  | { mode: "choose"; slots: Array<{ key: string; label: string }> };

export const signatureSlotControl = (
  slots: Array<{ key: string; label: string }>,
): SignatureSlotControl => {
  if (slots.length === 0) return { mode: "none" };
  if (slots.length === 1) return { mode: "auto", key: slots[0]!.key };
  return { mode: "choose", slots };
};

// Two approval steps must not sign the same slot on the same document — a
// config-time error, not a runtime surprise (ADR-043 §5).
export const signatureSlotConflict = (
  chosenKey: string,
  takenKeys: string[],
  slots: Array<{ key: string; label: string }>,
): string | null => {
  if (!chosenKey || !takenKeys.includes(chosenKey)) return null;
  const label = slots.find((slot) => slot.key === chosenKey)?.label ?? chosenKey;
  return `Another approval step already signs "${label}". Pick a different slot.`;
};

// The one-line summary shown on the canvas card, so an author can see what a
// step approves without opening it. The card has no view of the graph, so a
// named step is described by position rather than by name.
export const describeApprovalSubject = (config: {
  approvalSubject?: ApprovalSubject;
  signatureFieldKey?: string;
}): string => {
  const subject = config.approvalSubject;
  const base =
    subject?.kind === "custom"
      ? "Approves a described subject"
      : subject?.nodeId
        ? "Approves a chosen step"
        : "Approves the last completed step";
  return config.signatureFieldKey ? `${base} · signs the document` : base;
};

// Surfaced while authoring rather than left to be discovered at decision time:
// a change request against a flow with no editable predecessor holds the
// session instead of routing it.
export const noEditablePredecessorWarning = (
  priorSteps: PriorStep[],
  chosenNodeId: string,
): string | null => {
  if (chosenNodeId) return null;
  if (editableReturnSteps(priorSteps).length > 0) return null;
  return "No earlier step in this flow can be edited, so a change request will hold the session here instead of returning it. Add a conversational step before this approval.";
};
