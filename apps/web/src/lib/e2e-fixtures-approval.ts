// The seed fixtures for the approval-subject phase, kept beside the main seed
// rather than in it: two approvals signing one document is a large enough shape
// that inlining it pushed e2e-fixtures.ts past the source-size ceiling.

import type { Container } from "./container";
import { unwrap } from "./e2e-fixtures";

const SEED_SUBJECT_FLOW_NAME = "E2E SEED Approval Subject Flow";
const SEED_SUBJECT_SESSION_TITLE = "E2E SEED Approval Subject Session";
const SEED_SUBJECT_DOCUMENT = "delegation-instrument.docx";
const SEED_APPROVAL_FIRST_FLOW_NAME = "E2E SEED Approval First Flow";

export const seedApprovalSubjectSession = async (
  container: Container,
  ownerUserId: string,
): Promise<{ sessionId: string; flowId: string }> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_SUBJECT_FLOW_NAME,
      description: "Seeded flow with two approvals signing one document",
      expertRole: "Delegation Officer",
      ownerUserId,
    }),
    "create subject flow",
  );

  const documentNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Prepare instrument",
      positionX: 120,
      positionY: 120,
      config: {
        aiInstruction: "Draft the delegation instrument.",
        doneWhen: "The instrument is drafted.",
        outputType: "generate_document",
        documentTemplatePath: "templates/e2e-seed-instrument.docx",
        documentTemplateContent:
          "Delegation to {{Delegate Name}}.\n{{ Delegate Signature (approval) }}\n{{ Finance Signature (approval) }}",
        documentTemplateFields: [
          { key: "delegate_name", label: "Delegate Name", type: "text", optional: false, raw: "Delegate Name" },
          {
            key: "delegate_signature",
            label: "Delegate Signature",
            type: "signature",
            optional: true,
            raw: "Delegate Signature (approval)",
          },
          {
            key: "finance_signature",
            label: "Finance Signature",
            type: "signature",
            optional: true,
            raw: "Finance Signature (approval)",
          },
        ],
      },
    }),
    "create subject document node",
  );

  const delegateNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Delegate sign-off",
      positionX: 420,
      positionY: 120,
      config: {
        approverSource: "first_level_supervisor",
        approvalSubject: { kind: "step", nodeId: documentNode.id },
        signatureFieldKey: "delegate_signature",
      },
    }),
    "create delegate approval node",
  );

  const financeNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Finance sign-off",
      positionX: 720,
      positionY: 120,
      config: {
        approverSource: "first_level_supervisor",
        approvalSubject: { kind: "step", nodeId: documentNode.id },
        signatureFieldKey: "finance_signature",
      },
    }),
    "create finance approval node",
  );

  for (const [fromNodeId, toNodeId] of [
    [documentNode.id, delegateNode.id],
    [delegateNode.id, financeNode.id],
  ] as const) {
    unwrap(
      await container.useCases.createFlowEdge.execute({ flowId: flow.id, fromNodeId, toNodeId }),
      "create subject flow edge",
    );
  }

  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish subject flow",
  );

  const session = unwrap(
    await container.useCases.startSession.execute({ flowId: flow.id, userId: ownerUserId }),
    "start subject session",
  );

  const documentMessage = unwrap(
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: "Here is the delegation instrument.",
      confidence: 95,
      stepNodeId: documentNode.id,
      document: {
        filename: SEED_SUBJECT_DOCUMENT,
        // -r2: the delegate's decision already re-rendered and repointed it.
        storagePath: "context/e2e-seed/delegation-instrument-r2.docx",
        summary: "Delegation of purchasing authority to Acme Ltd.",
        generatedAt: new Date().toISOString(),
      },
      documentStatus: "complete",
    }),
    "create subject document message",
  );

  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: documentNode.id,
      messageId: documentMessage.id,
      fields: [
        { key: "delegate_name", label: "Delegate Name", type: "text", value: "Acme Ltd" },
      ],
    }),
    "create subject step output",
  );

  // The delegate's decided approval, with the record it locked.
  unwrap(
    await container.repos.approvals.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: delegateNode.id,
      requestedByUserId: ownerUserId,
      approverSource: "first_level_supervisor",
      approverUserId: ownerUserId,
      status: "approved",
      recordSnapshot: {
        subjectDescription: 'the output of the step "Prepare instrument"',
        subjectNodeId: documentNode.id,
        signatureFieldKey: "delegate_signature",
        attestationText:
          "Approved by:   Jane Doe\nDecision:      Approved\nVerification:  WF-3F9A2C1E7B04",
        "delegate_sign_off.decision": "approved",
        "delegate_sign_off.approver_name": "Jane Doe",
        "delegate_sign_off.approver_email": "jane.doe@example.com",
        "delegate_sign_off.decided_at": new Date().toISOString(),
        "delegate_sign_off.comment": "",
      },
    }),
    "create decided delegate approval",
  );

  // The projected decision output the second approver must NOT be shown.
  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: delegateNode.id,
      fields: [
        { key: "outcome", label: "Outcome", type: "text", value: "approved" },
        { key: "decided_by", label: "Decided by", type: "text", value: ownerUserId },
      ],
    }),
    "create delegate decision projection",
  );

  unwrap(
    await container.repos.sessions.update(session.id, {
      title: SEED_SUBJECT_SESSION_TITLE,
      currentNodeId: financeNode.id,
      // Deliberately names the previous *approval*: the context must not use it.
      graphCheckpoint: { currentNodeId: financeNode.id, advancedFrom: delegateNode.id },
    }),
    "park subject session on the second approval",
  );

  unwrap(
    await container.repos.approvals.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: financeNode.id,
      requestedByUserId: ownerUserId,
      approverSource: "first_level_supervisor",
      approverUserId: ownerUserId,
      status: "pending",
    }),
    "create pending finance approval",
  );

  return { sessionId: session.id, flowId: flow.id };
};

// An approval with no step before it, so the config editor has to warn that a
// change request has nowhere to return to (ADR-044 §2).
export const seedApprovalFirstFlow = async (
  container: Container,
  ownerUserId: string,
): Promise<string> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_APPROVAL_FIRST_FLOW_NAME,
      description: "Seeded flow whose first step is an approval",
      expertRole: "Delegation Officer",
      ownerUserId,
    }),
    "create approval-first flow",
  );

  unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Immediate sign-off",
      positionX: 120,
      positionY: 120,
      config: { approverSource: "first_level_supervisor" },
    }),
    "create approval-first node",
  );

  return flow.id;
};
