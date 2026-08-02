import {
  ok,
  type Approval,
  type ApprovalNodeConfig,
  type DocumentGenerationConfidence,
  type FlowNode,
  type IApprovalRepository,
  type IFlowNodeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUserRepository,
  type Result,
  type Session,
  type SessionDocument,
  type StepOutputField,
  type User,
} from "@rbrasier/domain";
import type { ResolveApprovalSubject } from "./resolve-approval-subject";

export interface PreviousStepDocument {
  messageId: string;
  document: SessionDocument;
  documentGenerationConfidence: DocumentGenerationConfidence | null;
}

// The key output the approver is signing off on. Exactly one of `document` /
// `fields` is populated — a document step shows the same card as the chat, any
// other step shows its captured output fields.
export interface PreviousStepContext {
  nodeId: string;
  stepName: string;
  document: PreviousStepDocument | null;
  fields: StepOutputField[] | null;
}

export interface PendingApprovalContext {
  approval: Approval;
  sessionId: string;
  chatName: string;
  originatorName: string | null;
  originatorEmail: string | null;
  previousStep: PreviousStepContext | null;
  // The statement of what is being approved, resolved from `approvalSubject`
  // (ADR-040 §2). Null only when the resolution itself failed.
  subjectDescription: string | null;
  // Which stage of the chain this is — the approval node's own name, and the
  // author's role steer where one was given. The queue shows both so an approver
  // knows whether they are the first or the second signature on this document.
  approvalStepName: string;
  roleHint: string | null;
}

export interface ListPendingApprovalsWithContextInput {
  approverUserId: string;
  approverEmail: string | null;
}

// Enriches the approver's pending queue with the context needed to decide:
// the chat name, who raised it, and the previous step's key output (the
// document, or its output fields). The approval row stays the source of truth;
// every enrichment is best-effort so a missing session or lookup never drops the
// pending request from the list.
export class ListPendingApprovalsWithContext {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly sessions: ISessionRepository,
    private readonly users: IUserRepository,
    private readonly messages: ISessionMessageRepository,
    private readonly stepOutputs: ISessionStepOutputRepository,
    private readonly flowNodes: IFlowNodeRepository,
    // The single resolver for what an approval is about. Sharing it with the
    // gate is what keeps the statement and the artefact from drifting apart —
    // splitting them is how `advancedFrom` came to be read for routing at all.
    private readonly approvalSubject: ResolveApprovalSubject,
  ) {}

  async execute(
    input: ListPendingApprovalsWithContextInput,
  ): Promise<Result<PendingApprovalContext[]>> {
    const pending = await this.approvals.listPendingForApprover(input);
    if (pending.error) return pending;

    const contexts = await Promise.all(pending.data.map((approval) => this.buildContext(approval)));
    return ok(contexts);
  }

  private async buildContext(approval: Approval): Promise<PendingApprovalContext> {
    const session = await this.findSession(approval.sessionId);
    const originator = await this.findUser(approval.requestedByUserId);
    const subject = await this.approvalSubject.execute({ approvalId: approval.id });
    const subjectNodeId = subject.error ? null : subject.data.subjectNodeId;
    const previousStep = subjectNodeId ? await this.resolveSubjectStep(approval, subjectNodeId) : null;
    const approvalNode = await this.findNode(approval.nodeId);
    const config = (approvalNode?.config ?? {}) as unknown as ApprovalNodeConfig;

    return {
      approval,
      sessionId: approval.sessionId,
      chatName: session?.title?.trim() || "Untitled chat",
      originatorName: originator?.name ?? null,
      originatorEmail: originator?.email ?? null,
      previousStep,
      subjectDescription: subject.error ? null : subject.data.description,
      approvalStepName: approvalNode?.name?.trim() || "Approval",
      roleHint: config.roleHint?.trim() || null,
    };
  }

  private async findNode(nodeId: string): Promise<FlowNode | null> {
    const result = await this.flowNodes.findById(nodeId);
    return result.error ? null : result.data;
  }

  private async findSession(sessionId: string): Promise<Session | null> {
    const result = await this.sessions.findById(sessionId);
    return result.error ? null : result.data;
  }

  private async findUser(userId: string): Promise<User | null> {
    const result = await this.users.findById(userId);
    return result.error ? null : result.data;
  }

  // Resolved from the approval's subject, never from `advancedFrom`: with two
  // approvals in sequence that back-pointer names the previous *approval*, so
  // the second approver would be shown a decision instead of the document
  // (ADR-040 §2). The document is looked up now, not at raise time, so an
  // earlier approval's signature is already on the revision returned.
  private async resolveSubjectStep(
    approval: Approval,
    subjectNodeId: string,
  ): Promise<PreviousStepContext | null> {
    const stepName = await this.resolveNodeName(subjectNodeId);

    const document = await this.resolvePreviousDocument(approval.sessionId, subjectNodeId);
    if (document) {
      return { nodeId: subjectNodeId, stepName, document, fields: null };
    }

    const fields = await this.resolvePreviousFields(approval.sessionId, subjectNodeId);
    return { nodeId: subjectNodeId, stepName, document: null, fields };
  }

  private async resolveNodeName(nodeId: string): Promise<string> {
    const result = await this.flowNodes.findById(nodeId);
    if (result.error || !result.data) return "Previous step";
    return result.data.name?.trim() || "Previous step";
  }

  private async resolvePreviousDocument(
    sessionId: string,
    nodeId: string,
  ): Promise<PreviousStepDocument | null> {
    const result = await this.messages.listBySession(sessionId);
    if (result.error) return null;

    const latest = result.data
      .filter((message) => message.stepNodeId === nodeId && message.document)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];
    if (!latest || !latest.document) return null;

    return {
      messageId: latest.id,
      document: latest.document,
      documentGenerationConfidence: latest.aiPayload?.documentGenerationConfidence ?? null,
    };
  }

  private async resolvePreviousFields(
    sessionId: string,
    nodeId: string,
  ): Promise<StepOutputField[] | null> {
    const result = await this.stepOutputs.listBySession(sessionId);
    if (result.error) return null;

    const latest = result.data
      .filter((output) => output.nodeId === nodeId)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];
    return latest ? latest.fields : null;
  }
}
