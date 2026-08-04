import {
  ConfirmAndSend,
  DecideApproval,
  ListPendingApprovals,
  ListPendingApprovalsWithContext,
  SuggestApprover,
} from "@rbrasier/application";
// The two notifier ports are declared beside their use cases in the application
// package, not in domain.
import type {
  IApprovalDecidedNotifier,
  IApprovalRequestedNotifier,
} from "@rbrasier/application";
import type {
  IApprovalRepository,
  IAuditLogger,
  IDocumentChunkRepository,
  IEmbeddingsProvider,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  ILanguageModel,
  IReportingLineResolver,
  ISessionMessageRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  IUnitOfWork,
  IUserRepository,
} from "@rbrasier/domain";

export interface ApprovalUseCaseDeps {
  approvals: IApprovalRepository;
  auditLogger: IAuditLogger;
  documentChunks: IDocumentChunkRepository;
  embeddings: IEmbeddingsProvider;
  flowEdges: IFlowEdgeRepository;
  flowNodes: IFlowNodeRepository;
  languageModel: ILanguageModel;
  notifyOnApprovalDecided: IApprovalDecidedNotifier;
  notifyOnApprovalRequested: IApprovalRequestedNotifier;
  reportingLineResolver: IReportingLineResolver;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  sessions: ISessionRepository;
  unitOfWork: IUnitOfWork;
  users: IUserRepository;
}

// The approval-chain use-case cluster, factored out of the main container to
// keep container.ts under the source-size ceiling. Spread into the container's
// `useCases` map; behaviour and wiring are unchanged.
export const buildApprovalUseCases = (deps: ApprovalUseCaseDeps) => ({
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
  ),
  listPendingApprovals: new ListPendingApprovals(deps.approvals),
  listPendingApprovalsWithContext: new ListPendingApprovalsWithContext(
    deps.approvals,
    deps.sessions,
    deps.users,
    deps.sessionMessages,
    deps.sessionStepOutputs,
    deps.flowNodes,
  ),
});
