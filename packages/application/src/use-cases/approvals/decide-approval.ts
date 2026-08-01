import {
  buildApprovalRecord,
  buildAttestationBlock,
  deriveStepKeys,
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalDecision,
  type ApprovalNodeConfig,
  type FlowNode,
  type IApprovalRepository,
  type IAuditLogger,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUnitOfWork,
  type IUserRepository,
  type Result,
  type Sha256Hex,
  type StepOutputField,
  type TransactionalRepositories,
} from "@rbrasier/domain";
import type { IApprovalDecidedNotifier } from "../notifications/notify-on-approval-decided";
import type { ApplyApprovalSignature } from "./apply-approval-signature";
import {
  ATTESTATION_TEXT_KEY,
  SIGNATURE_FIELD_KEY,
  STEP_KEY,
  SUBJECT_DESCRIPTION_KEY,
  SUBJECT_NODE_ID_KEY,
} from "./approval-record-keys";
import type { ResolveApprovalSubject } from "./resolve-approval-subject";

export interface DecideApprovalInput {
  approvalId: string;
  decidedByUserId: string;
  decision: ApprovalDecision;
  comment?: string | null;
  // Only meaningful for `rejected`: true routes the session back to the
  // originator, false (or missing) cancels it. `changes_requested` always routes
  // back; `approved` ignores it.
  routeBack?: boolean;
  // The tRPC layer sets this for admins so they can act on behalf of an approver.
  isAdmin?: boolean;
}

export interface DecideApprovalOutput {
  approval: Approval;
  advanced: boolean;
  newNodeId: string | null;
  sessionCompleted: boolean;
}

const field = (key: string, label: string, value: string): StepOutputField => ({
  key,
  label,
  type: "text",
  value,
});

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

// The record key prefix for this approval node. Derived across the flow's whole
// approval set so two steps sharing a label get distinct keys, and derived from
// the label so the prefix reads as the step name in a report (ADR-040 §5).
const approvalStepKey = (nodes: FlowNode[], nodeId: string): string => {
  const approvalNodes = [...nodes]
    .filter((node) => node.type === "approval")
    .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
  const keys = deriveStepKeys(approvalNodes.map((node) => node.name));
  const index = approvalNodes.findIndex((node) => node.id === nodeId);
  return index >= 0 ? keys[index]! : "approval";
};

// A committed decision plus how the chat and notification side effects should
// describe it. Produced inside the transaction, consumed after it commits.
interface DecisionEffect {
  output: DecideApprovalOutput;
  routedBack: boolean;
}

// Records an approver's decision. Approve snapshots the step outputs and advances
// the session; reject / changes-requested surface the comment and hold. The
// outcome is projected onto the node's step-output metadata for reporting.
export class DecideApproval {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly approvals: IApprovalRepository,
    private readonly sessions: ISessionRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly notifier?: IApprovalDecidedNotifier,
    private readonly messages?: ISessionMessageRepository,
    // Needed to authorise decisions on email-assigned approvals — the decider's
    // account email must match the assigned address, and to copy the approver's
    // identity into the record rather than joining it at read time.
    private readonly users?: IUserRepository,
    // The record-building dependencies. Optional so the decision path still
    // works unwired: an approval that records no subject or signature is worse
    // than one that does, but losing the decision itself would be worse again.
    private readonly flowNodes?: IFlowNodeRepository,
    private readonly sha256Hex?: Sha256Hex,
    private readonly approvalSubject?: ResolveApprovalSubject,
    private readonly applySignature?: ApplyApprovalSignature,
  ) {}

  async execute(input: DecideApprovalInput): Promise<Result<DecideApprovalOutput>> {
    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    const approval = found.data;
    if (!approval) {
      return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));
    }
    if (approval.status !== "pending") {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }
    if (!(await this.isAuthorisedDecider(approval, input))) {
      return err(domainError("FORBIDDEN", "Only the confirmed approver can decide this."));
    }

    const decidedAt = new Date();
    const recordSnapshot = await this.buildRecord(approval, input, decidedAt);

    // The concurrency-gated approval update and the session advance/route commit
    // together: a crash between them must never leave a decided approval sitting
    // on a session that never moved. The best-effort projection, audit, chat
    // message and notification run only after the commit succeeds, so a
    // rolled-back decision leaves no trace of its side effects.
    const effect = await this.unitOfWork.withTransaction((repositories) =>
      this.decideWithin(repositories, approval, input, decidedAt, recordSnapshot),
    );
    if (effect.error) return effect;

    const { output, routedBack } = effect.data;
    const decided = output.approval;

    await this.projectDecision(decided, decidedAt);
    await this.auditLogger.log({
      actorId: input.decidedByUserId,
      action: "approval.decided",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: { decision: input.decision, comment: input.comment ?? null },
    });
    await this.recordDecisionMessage(decided, input.decision, routedBack);
    await this.writeSignature(decided);
    this.notify(decided, input.decision, routedBack);

    return ok(output);
  }

  // The decision is already committed and the record already frozen, so a
  // storage failure here loses a re-render, not an approval (ADR-043 §6). It is
  // a retryable follow-up: the attestation lives in the record and can be
  // written into the document again.
  private async writeSignature(approval: Approval): Promise<void> {
    if (!this.applySignature) return;
    try {
      await this.applySignature.execute({ approvalId: approval.id });
    } catch {
      // Ignore — the approval row remains the source of truth.
    }
  }

  // The record frozen at decision time (ADR-040 §3). Every decided approval gets
  // the five guaranteed keys prefixed by its step key; an approval carrying a
  // signature slot also gets the rendered attestation, stored rather than
  // recomputed so a later change around it can never alter what was signed.
  private async buildRecord(
    approval: Approval,
    input: DecideApprovalInput,
    decidedAt: Date,
  ): Promise<Record<string, unknown> | null> {
    const existing = approval.recordSnapshot ?? {};
    const stepOutputs =
      input.decision === "approved" ? await this.snapshot(approval.sessionId) : null;

    const nodes = await this.flowNodesOfFlow(approval.flowId);
    const stepKey = approvalStepKey(nodes, approval.nodeId);
    const approver = await this.approverIdentity(input.decidedByUserId);
    const subject = await this.resolveSubject(approval, existing);

    const record: Record<string, unknown> = {
      ...existing,
      ...(stepOutputs ?? {}),
      [STEP_KEY]: stepKey,
      ...buildApprovalRecord({
        stepKey,
        decision: input.decision,
        approverName: approver.name,
        approverEmail: approver.email,
        decidedAt,
        comment: input.comment ?? null,
        subjectDescription: subject.description,
        subjectNodeId: subject.nodeId,
        ...(subject.signatureFieldKey ? { signatureFieldKey: subject.signatureFieldKey } : {}),
      }),
    };

    if (!subject.signatureFieldKey || !this.sha256Hex) return record;

    const attestation = buildAttestationBlock(
      {
        approvalId: approval.id,
        sessionId: approval.sessionId,
        nodeId: approval.nodeId,
        approverName: approver.name,
        approverEmail: approver.email,
        approverRole: approver.role,
        decision: input.decision,
        decidedAt,
        comment: input.comment ?? null,
        subjectDescription: subject.description,
      },
      this.sha256Hex,
    );

    return {
      ...record,
      [SIGNATURE_FIELD_KEY]: subject.signatureFieldKey,
      [ATTESTATION_TEXT_KEY]: attestation.text,
      [`${stepKey}.verification_code`]: attestation.verificationCode,
    };
  }

  private async flowNodesOfFlow(flowId: string): Promise<FlowNode[]> {
    if (!this.flowNodes) return [];
    const result = await this.flowNodes.listByFlow(flowId);
    return result.error ? [] : result.data;
  }

  // Copied in, never joined at read time: a later rename, an email change or a
  // deleted account must not alter what the record says was true (ADR-040 §5).
  private async approverIdentity(
    userId: string,
  ): Promise<{ name: string | null; email: string | null; role: string | null }> {
    if (!this.users) return { name: null, email: null, role: null };
    const result = await this.users.findById(userId);
    if (result.error || !result.data) return { name: null, email: null, role: null };
    return {
      name: result.data.name,
      email: result.data.email,
      role: result.data.role,
    };
  }

  private async resolveSubject(
    approval: Approval,
    existing: Record<string, unknown>,
  ): Promise<{
    description: string | null;
    nodeId: string | null;
    signatureFieldKey: string | null;
  }> {
    const resolved = this.approvalSubject
      ? await this.approvalSubject.execute({ approvalId: approval.id })
      : null;

    const description =
      resolved && !resolved.error
        ? resolved.data.description
        : stringOrNull(existing[SUBJECT_DESCRIPTION_KEY]);
    const nodeId =
      resolved && !resolved.error
        ? resolved.data.subjectNodeId
        : stringOrNull(existing[SUBJECT_NODE_ID_KEY]);

    const nodes = await this.flowNodesOfFlow(approval.flowId);
    const config = (nodes.find((node) => node.id === approval.nodeId)?.config ??
      {}) as unknown as ApprovalNodeConfig;

    return { description, nodeId, signatureFieldKey: config.signatureFieldKey ?? null };
  }

  // The atomic core: the pending-guard update and the session write share one
  // transaction. A null from `updateIfPending` means a concurrent decider won
  // the race, so the whole transaction fails and no side effects run.
  private async decideWithin(
    repositories: TransactionalRepositories,
    approval: Approval,
    input: DecideApprovalInput,
    decidedAt: Date,
    recordSnapshot: Record<string, unknown> | null,
  ): Promise<Result<DecisionEffect>> {
    const updated = await repositories.approvals.updateIfPending(approval.id, {
      status: input.decision,
      decidedByUserId: input.decidedByUserId,
      decidedAt,
      comment: input.comment ?? null,
      recordSnapshot,
    });
    if (updated.error) return updated;
    if (!updated.data) {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }
    const decided = updated.data;

    if (input.decision === "approved") {
      return this.advance(repositories, decided);
    }
    return this.routeBackOrCancel(repositories, decided, input);
  }

  // Approve/reject is gated to the assigned approver (or an admin). A user-id
  // assignment matches on id; an email-only assignment (ADR-018, before the
  // recipient has claimed an account) matches on the decider's account email.
  // With no assignment there is no one to match, so only an admin may decide.
  private async isAuthorisedDecider(
    approval: Approval,
    input: DecideApprovalInput,
  ): Promise<boolean> {
    if (input.isAdmin) return true;
    if (approval.approverUserId) return approval.approverUserId === input.decidedByUserId;
    if (approval.approverEmail) {
      return this.deciderEmailMatches(input.decidedByUserId, approval.approverEmail);
    }
    return false;
  }

  private async deciderEmailMatches(userId: string, approverEmail: string): Promise<boolean> {
    if (!this.users) return false;
    const found = await this.users.findById(userId);
    if (found.error || !found.data) return false;
    return found.data.email.toLowerCase() === approverEmail.toLowerCase();
  }

  private notify(approval: Approval, decision: ApprovalDecision, routedBack: boolean): void {
    void this.notifier?.execute({ approval, decision, routedBack }).catch(() => undefined);
  }

  // Surfaces the decision and its reason in the chat thread so everyone with the
  // session open sees the outcome. Best-effort — a message-write failure must not
  // fail the decision, mirroring the projection above.
  private async recordDecisionMessage(
    approval: Approval,
    decision: ApprovalDecision,
    routedBack: boolean,
  ): Promise<void> {
    if (!this.messages) return;
    const summary = this.decisionSummary(decision, routedBack);
    const content = approval.comment ? `${summary}\n\nComment: ${approval.comment}` : summary;
    try {
      await this.messages.create({
        sessionId: approval.sessionId,
        role: "system",
        content,
        stepNodeId: approval.nodeId,
      });
    } catch {
      // Ignore — the approval row remains the source of truth.
    }
  }

  private decisionSummary(decision: ApprovalDecision, routedBack: boolean): string {
    if (decision === "approved") return "Approval granted.";
    if (decision === "changes_requested") return "Changes requested by the approver.";
    return routedBack
      ? "Approval rejected — routed back to the originator."
      : "Approval rejected — the request was closed.";
  }

  // Non-approve decisions either return the session to the originator (route-back)
  // or close it. `changes_requested` always routes back; `rejected` routes back
  // only when the approver chose to, and a missing previous node forces a cancel
  // since there is nowhere to return to.
  private async routeBackOrCancel(
    repositories: TransactionalRepositories,
    approval: Approval,
    input: DecideApprovalInput,
  ): Promise<Result<DecisionEffect>> {
    const sessionResult = await this.sessions.findById(approval.sessionId);
    if (sessionResult.error) return sessionResult;
    const session = sessionResult.data;
    if (!session) {
      return err(domainError("NOT_FOUND", `Session ${approval.sessionId} not found.`));
    }

    const previousNodeId = this.previousNodeId(session);
    const shouldRouteBack = input.decision === "changes_requested" || input.routeBack === true;

    if (shouldRouteBack && previousNodeId) {
      const moved = await repositories.sessions.update(session.id, {
        currentNodeId: previousNodeId,
        graphCheckpoint: { currentNodeId: previousNodeId, advancedFrom: null },
      });
      if (moved.error) return moved;
      return ok({
        output: { approval, advanced: true, newNodeId: previousNodeId, sessionCompleted: false },
        routedBack: true,
      });
    }

    const cancelled = await repositories.sessions.update(session.id, { status: "cancelled" });
    if (cancelled.error) return cancelled;
    return ok({
      output: { approval, advanced: false, newNodeId: null, sessionCompleted: true },
      routedBack: false,
    });
  }

  private previousNodeId(session: { graphCheckpoint: Record<string, unknown> | null }): string | null {
    const value = session.graphCheckpoint?.["advancedFrom"];
    return typeof value === "string" ? value : null;
  }

  private async snapshot(sessionId: string): Promise<Record<string, unknown> | null> {
    const outputs = await this.sessionStepOutputs.listBySession(sessionId);
    if (outputs.error) return null;
    return { stepOutputs: outputs.data };
  }

  // Best-effort denormalised projection — the approval row stays the source of
  // truth, so a projection failure must not fail the decision.
  private async projectDecision(approval: Approval, decidedAt: Date): Promise<void> {
    await this.sessionStepOutputs.create({
      sessionId: approval.sessionId,
      flowId: approval.flowId,
      nodeId: approval.nodeId,
      fields: [
        field("outcome", "Outcome", approval.status),
        field("decided_at", "Decided at", decidedAt.toISOString()),
        field("decided_by", "Decided by", approval.decidedByUserId ?? ""),
        field("comment", "Comment", approval.comment ?? ""),
      ],
    });
  }

  private async advance(
    repositories: TransactionalRepositories,
    approval: Approval,
  ): Promise<Result<DecisionEffect>> {
    const sessionResult = await this.sessions.findById(approval.sessionId);
    if (sessionResult.error) return sessionResult;
    const session = sessionResult.data;
    if (!session) {
      return err(domainError("NOT_FOUND", `Session ${approval.sessionId} not found.`));
    }

    const edgesResult = await this.flowEdges.listByFlow(approval.flowId);
    if (edgesResult.error) return edgesResult;
    const outgoing = edgesResult.data.filter((edge) => edge.fromNodeId === approval.nodeId);

    if (outgoing.length === 0) {
      const completed = await repositories.sessions.update(session.id, { status: "complete" });
      if (completed.error) return completed;
      return ok({
        output: { approval, advanced: true, newNodeId: null, sessionCompleted: true },
        routedBack: false,
      });
    }

    // A fork after an approval cannot be auto-chosen; the session parks at the
    // node for the operator to pick a branch, mirroring the other advance paths.
    if (outgoing.length > 1) {
      return ok({
        output: { approval, advanced: false, newNodeId: null, sessionCompleted: false },
        routedBack: false,
      });
    }

    const newNodeId = outgoing[0]!.toNodeId;
    const moved = await repositories.sessions.update(session.id, {
      currentNodeId: newNodeId,
      graphCheckpoint: { currentNodeId: newNodeId, advancedFrom: approval.nodeId },
    });
    if (moved.error) return moved;
    return ok({
      output: { approval, advanced: true, newNodeId, sessionCompleted: false },
      routedBack: false,
    });
  }
}
