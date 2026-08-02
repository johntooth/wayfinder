import {
  ApplyApprovalSignature,
  ApproverEditSubjectFields,
  ConfirmAndSend,
  DecideApproval,
  ListPendingApprovals,
  ListPendingApprovalsWithContext,
  ResolveApprovalSubject,
  SuggestApprover,
  type UpdateDocumentFields,
} from "@rbrasier/application";
import type {
  IApprovalRepository,
  IAuditLogger,
  IDocumentChunkRepository,
  IDocumentGenerator,
  IEmbeddingsProvider,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  ILanguageModel,
  IObjectStorage,
  IReportingLineResolver,
  ISessionMessageRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  IUnitOfWork,
  IUserRepository,
  Sha256Hex,
} from "@rbrasier/domain";

export interface ApprovalUseCaseDeps {
  unitOfWork: IUnitOfWork;
  approvals: IApprovalRepository;
  sessions: ISessionRepository;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  flowNodes: IFlowNodeRepository;
  flowEdges: IFlowEdgeRepository;
  users: IUserRepository;
  auditLogger: IAuditLogger;
  languageModel: ILanguageModel;
  documentGenerator: IDocumentGenerator;
  objectStorage: IObjectStorage;
  reportingLineResolver: IReportingLineResolver;
  embeddings: IEmbeddingsProvider;
  documentChunks: IDocumentChunkRepository;
  sha256Hex: Sha256Hex;
  updateDocumentFields: UpdateDocumentFields;
  notifyOnApprovalRequested: ConstructorParameters<typeof ConfirmAndSend>[2];
  notifyOnApprovalDecided: ConstructorParameters<typeof DecideApproval>[6];
}

// The approval use-case cluster, factored out of the main container to keep
// container.ts under the source-size ceiling. Spread into the container's
// `useCases` map; behaviour and wiring are unchanged.
export const buildApprovalUseCases = (deps: ApprovalUseCaseDeps) => {
  // Shared, not constructed twice: the gate and the approver's context must
  // resolve the subject the same way or they drift apart (ADR-040 §2).
  const resolveApprovalSubject = new ResolveApprovalSubject(
    deps.approvals,
    deps.flowNodes,
    deps.sessionStepOutputs,
    deps.sessionMessages,
    deps.languageModel,
  );

  const applyApprovalSignature = new ApplyApprovalSignature(
    deps.approvals,
    deps.flowNodes,
    deps.sessionMessages,
    deps.sessionStepOutputs,
    deps.documentGenerator,
    deps.objectStorage,
  );

  return {
    resolveApprovalSubject,
    applyApprovalSignature,
    approverEditSubjectFields: new ApproverEditSubjectFields(
      deps.approvals,
      deps.users,
      deps.sessionMessages,
      deps.updateDocumentFields,
    ),
    suggestApprover: new SuggestApprover(
      deps.approvals,
      deps.flowNodes,
      deps.reportingLineResolver,
      deps.users,
      deps.embeddings,
      deps.documentChunks,
      deps.languageModel,
    ),
    confirmAndSend: new ConfirmAndSend(
      deps.approvals,
      deps.auditLogger,
      deps.notifyOnApprovalRequested,
    ),
    decideApproval: new DecideApproval(
      deps.unitOfWork,
      deps.approvals,
      deps.sessions,
      deps.flowEdges,
      deps.sessionStepOutputs,
      deps.auditLogger,
      deps.notifyOnApprovalDecided,
      deps.sessionMessages,
      deps.users,
      deps.flowNodes,
      deps.sha256Hex,
      resolveApprovalSubject,
      applyApprovalSignature,
    ),
    listPendingApprovals: new ListPendingApprovals(deps.approvals),
    listPendingApprovalsWithContext: new ListPendingApprovalsWithContext(
      deps.approvals,
      deps.sessions,
      deps.users,
      deps.sessionMessages,
      deps.sessionStepOutputs,
      deps.flowNodes,
      resolveApprovalSubject,
    ),
  };
};
