import type { ApprovalSubject, ChangesRequestedTarget } from "@rbrasier/domain";
import {
  decodeApprovalSubject,
  decodeChangesRequestedTarget,
  encodeApprovalSubject,
  encodeChangesRequestedTarget,
} from "./approval-node-config";
import type { NodeConfigValues } from "./node-config-values";

// The approval node's persisted config, read from and written to the modal's
// form values. Each of the three new fields is written only when the author
// chose something other than the default, so an untouched node stores nothing
// new and keeps behaving exactly as it did.

export const approvalConfigFromValues = (
  values: NodeConfigValues,
): Record<string, unknown> => {
  const approvalSubject = decodeApprovalSubject({
    kind: values.approvalSubjectKind,
    nodeId: values.approvalSubjectNodeId,
    instruction: values.approvalSubjectInstruction,
  });
  const changesRequestedTarget = decodeChangesRequestedTarget(
    values.changesRequestedTargetNodeId,
  );

  return {
    approverSource: values.approverSource,
    roleHint: values.roleHint,
    instructions: values.approvalInstructions,
    ...(approvalSubject ? { approvalSubject } : {}),
    ...(values.signatureFieldKey ? { signatureFieldKey: values.signatureFieldKey } : {}),
    ...(changesRequestedTarget ? { changesRequestedTarget } : {}),
    notifyOnComplete: values.notifyOnComplete,
  };
};

export const approvalValuesFromConfig = (
  config: Record<string, unknown>,
): Pick<
  NodeConfigValues,
  | "approvalSubjectKind"
  | "approvalSubjectNodeId"
  | "approvalSubjectInstruction"
  | "signatureFieldKey"
  | "changesRequestedTargetNodeId"
> => {
  const subject = encodeApprovalSubject(config.approvalSubject as ApprovalSubject | undefined);
  return {
    approvalSubjectKind: subject.kind,
    approvalSubjectNodeId: subject.nodeId,
    approvalSubjectInstruction: subject.instruction,
    signatureFieldKey: (config.signatureFieldKey as string | null) ?? "",
    changesRequestedTargetNodeId: encodeChangesRequestedTarget(
      config.changesRequestedTarget as ChangesRequestedTarget | undefined,
    ),
  };
};
