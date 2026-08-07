import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  domainError,
  err,
  isSessionDiscarded,
  ok,
  type Approval,
  type ApprovalListScope,
  type ApprovalStatus,
  type ApprovalUpdate,
  type FlowEdge,
  type FlowNode,
  type IApprovalRepository,
  type DocumentChunkSearch,
  type GenerateObjectInput,
  type IAuditLogger,
  type IDocumentChunkRepository,
  type IEmbeddingsProvider,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type ILanguageModel,
  type IReportingLineResolver,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUnitOfWork,
  type IUserRepository,
  type NewApproval,
  type NewAuditLog,
  type NewSessionMessage,
  type NewSessionStepOutput,
  type NewUser,
  type SessionMessage,
  type NotificationLog,
  type Person,
  type PositionLookupInput,
  type ReportingLineSuggestion,
  type Result,
  type RetrievedChunk,
  type Session,
  type SessionStepOutput,
  type SessionStatus,
  type SessionUpdate,
  type TokenUsage,
  type TransactionalRepositories,
  type UnresolvedSuggestion,
  type User,
} from "@rbrasier/domain";
import { SuggestApprover } from "./suggest-approver";
import { ConfirmAndSend } from "./confirm-and-send";
import { DecideApproval } from "./decide-approval";
import { ListApprovals } from "./list-approvals";
import { ListApprovalsWithContext } from "./list-approvals-with-context";
import { ResolveApprovalSubject } from "./resolve-approval-subject";
import { WithdrawApproval } from "./withdraw-approval";
import { ReassignApproval } from "./reassign-approval";
import type {
  IApprovalDecidedNotifier,
  NotifyOnApprovalDecidedInput,
} from "../notifications/notify-on-approval-decided";
import type {
  IApprovalWithdrawnNotifier,
  NotifyOnApprovalWithdrawnInput,
} from "../notifications/notify-on-approval-withdrawn";
import type {
  IApprovalReassignedNotifier,
  NotifyOnApprovalReassignedInput,
} from "../notifications/notify-on-approval-reassigned";
import type {
  IApprovalRequestedNotifier,
  NotifyOnApprovalRequestedInput,
} from "../notifications/notify-on-approval-requested";

class InMemoryApprovals implements IApprovalRepository {
  rows = new Map<string, Approval>();
  private seq = 0;

  async create(input: NewApproval): Promise<Result<Approval>> {
    const now = new Date();
    const approval: Approval = {
      id: `appr-${(this.seq += 1)}`,
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      messageId: input.messageId ?? null,
      requestedByUserId: input.requestedByUserId,
      approverSource: input.approverSource,
      suggestedApproverUserId: input.suggestedApproverUserId ?? null,
      approverUserId: input.approverUserId ?? null,
      approverEmail: input.approverEmail ?? null,
      isOverride: input.isOverride ?? false,
      status: input.status ?? "pending",
      decidedByUserId: null,
      decidedAt: null,
      comment: null,
      requestMessage: input.requestMessage ?? null,
      recordSnapshot: input.recordSnapshot ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(approval.id, approval);
    return ok(approval);
  }

  async findById(id: string): Promise<Result<Approval | null>> {
    return ok(this.rows.get(id) ?? null);
  }

  async findPendingByNode(sessionId: string, nodeId: string): Promise<Result<Approval | null>> {
    const found =
      [...this.rows.values()].find(
        (row) => row.sessionId === sessionId && row.nodeId === nodeId && row.status === "pending",
      ) ?? null;
    return ok(found);
  }

  // Mirrors the port's session-state contract, which the SQL implementation
  // enforces with a join: a discarded session's approvals are not in anyone's
  // queue. Statuses default to `active` for the many tests that never set one.
  sessionStatuses = new Map<string, SessionStatus>();

  private assigned(row: Approval, input: { approverUserId: string; approverEmail: string | null }) {
    return (
      row.approverUserId === input.approverUserId ||
      (input.approverEmail !== null && row.approverEmail === input.approverEmail)
    );
  }

  private discarded(row: Approval): boolean {
    return isSessionDiscarded(this.sessionStatuses.get(row.sessionId) ?? "active");
  }

  async listPendingForApprover(input: {
    approverUserId: string;
    approverEmail: string | null;
  }): Promise<Result<Approval[]>> {
    return ok(
      [...this.rows.values()].filter(
        (row) => row.status === "pending" && this.assigned(row, input) && !this.discarded(row),
      ),
    );
  }

  async listForApprover(
    input: { approverUserId: string; approverEmail: string | null; scope: ApprovalListScope },
  ): Promise<Result<Approval[]>> {
    const matches = (row: Approval): boolean => {
      if (input.scope === "pending") {
        return row.status === "pending" && this.assigned(row, input) && !this.discarded(row);
      }
      // Their own decision stays theirs even if the row was later reassigned.
      const decided =
        row.status !== "pending" &&
        (this.assigned(row, input) || row.decidedByUserId === input.approverUserId);
      if (input.scope === "decided") return decided;
      return decided || (row.status === "pending" && this.assigned(row, input) && !this.discarded(row));
    };
    return ok(
      [...this.rows.values()]
        .filter(matches)
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime()),
    );
  }

  async listBySession(sessionId: string): Promise<Result<Approval[]>> {
    return ok([...this.rows.values()].filter((row) => row.sessionId === sessionId));
  }

  async update(id: string, patch: ApprovalUpdate): Promise<Result<Approval>> {
    const row = this.rows.get(id);
    if (!row) return err(domainError("NOT_FOUND", `Approval ${id} not found.`));
    const next: Approval = { ...row, ...patch, updatedAt: new Date() };
    this.rows.set(id, next);
    return ok(next);
  }

  async updateIfPending(id: string, patch: ApprovalUpdate): Promise<Result<Approval | null>> {
    const row = this.rows.get(id);
    if (!row || row.status !== "pending") return ok(null);
    const next: Approval = { ...row, ...patch, updatedAt: new Date() };
    this.rows.set(id, next);
    return ok(next);
  }
}

class InMemoryFlowNodes implements IFlowNodeRepository {
  rows = new Map<string, FlowNode>();

  add(node: FlowNode): void {
    this.rows.set(node.id, node);
  }
  async create(): Promise<Result<FlowNode>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async findById(id: string): Promise<Result<FlowNode | null>> {
    return ok(this.rows.get(id) ?? null);
  }
  async listByFlow(flowId: string): Promise<Result<FlowNode[]>> {
    return ok([...this.rows.values()].filter((node) => node.flowId === flowId));
  }
  async update(): Promise<Result<FlowNode>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async updatePosition(): Promise<Result<FlowNode>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

class StubResolver implements IReportingLineResolver {
  lastLookup: PositionLookupInput | null = null;
  constructor(
    private readonly suggestion: ReportingLineSuggestion | UnresolvedSuggestion,
    private readonly holders: Person[] = [],
  ) {}
  async suggest(): Promise<Result<ReportingLineSuggestion | UnresolvedSuggestion>> {
    return ok(this.suggestion);
  }
  async findPositionHolder(input: PositionLookupInput): Promise<Result<Person[]>> {
    this.lastLookup = input;
    return ok(this.holders);
  }
}

class StubEmbeddings implements IEmbeddingsProvider {
  async embed(_text: string): Promise<Result<number[]>> {
    return ok([0.1, 0.2, 0.3]);
  }
}

class StubDocumentChunks implements IDocumentChunkRepository {
  constructor(private readonly chunks: RetrievedChunk[]) {}
  async insertMany(): Promise<Result<void>> {
    return ok(undefined);
  }
  async deleteByStoragePath(): Promise<Result<void>> {
    return ok(undefined);
  }
  async search(_input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>> {
    return ok(this.chunks);
  }
}

const usage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

class StubLanguageModel implements ILanguageModel {
  readonly provider = "openai" as const;
  constructor(private readonly object: Record<string, string>) {}
  async generateObject<T>(_input: GenerateObjectInput): Promise<Result<{ object: T; usage: TokenUsage }>> {
    return ok({ object: this.object as T, usage });
  }
  async streamText(): Promise<never> {
    throw new Error("unused");
  }
  async streamObject(): Promise<never> {
    throw new Error("unused");
  }
}

const policyChunk = (chunkText: string): RetrievedChunk => ({
  filename: "delegation-policy.pdf",
  chunkIndex: 0,
  chunkText,
  sourceType: "flow_context_doc",
  similarity: 0.82,
});

class InMemoryUsers implements IUserRepository {
  rows = new Map<string, User>();
  add(user: User): void {
    this.rows.set(user.id, user);
  }
  async create(input: NewUser): Promise<Result<User>> {
    const now = new Date();
    const user: User = {
      id: input.email,
      email: input.email,
      name: input.name ?? null,
      role: null,
      team: null,
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(user.id, user);
    return ok(user);
  }
  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.rows.get(id) ?? null);
  }
  async findByEmail(email: string): Promise<Result<User | null>> {
    return ok([...this.rows.values()].find((user) => user.email === email) ?? null);
  }
  async search(input: { query: string; limit: number }): Promise<Result<User[]>> {
    const term = input.query.trim().toLowerCase();
    if (term.length === 0) return ok([]);
    const matches = [...this.rows.values()].filter(
      (row) =>
        row.email.toLowerCase().includes(term) ||
        (row.name ?? "").toLowerCase().includes(term),
    );
    return ok(matches.slice(0, input.limit));
  }

  async list(): Promise<Result<User[]>> {
    return ok([...this.rows.values()]);
  }
  async update(): Promise<Result<User>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

class InMemorySessions implements ISessionRepository {
  rows = new Map<string, Session>();
  add(session: Session): void {
    this.rows.set(session.id, session);
  }
  async create(): Promise<Result<Session>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async findById(id: string): Promise<Result<Session | null>> {
    return ok(this.rows.get(id) ?? null);
  }
  async listByUser(): Promise<Result<Session[]>> {
    return ok([...this.rows.values()]);
  }
  async listAll(): Promise<Result<Session[]>> {
    return ok([...this.rows.values()]);
  }
  async update(id: string, patch: SessionUpdate): Promise<Result<Session>> {
    const row = this.rows.get(id);
    if (!row) return err(domainError("NOT_FOUND", `Session ${id} not found.`));
    const next: Session = { ...row, ...patch, updatedAt: new Date() };
    this.rows.set(id, next);
    return ok(next);
  }
  async claimTurn(): Promise<Result<never>> {
    throw new Error("not used");
  }
  async heartbeatTurn(): Promise<Result<void>> {
    return ok(undefined);
  }
  async releaseTurn(): Promise<Result<void>> {
    return ok(undefined);
  }
}

class InMemoryFlowEdges implements IFlowEdgeRepository {
  rows: FlowEdge[] = [];
  async create(): Promise<Result<FlowEdge>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async listByFlow(flowId: string): Promise<Result<FlowEdge[]>> {
    return ok(this.rows.filter((edge) => edge.flowId === flowId));
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

class InMemoryStepOutputs implements ISessionStepOutputRepository {
  rows: SessionStepOutput[] = [];
  async create(input: NewSessionStepOutput): Promise<Result<SessionStepOutput>> {
    const now = new Date();
    const output: SessionStepOutput = {
      id: `out-${this.rows.length + 1}`,
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      messageId: input.messageId ?? null,
      fields: input.fields,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(output);
    return ok(output);
  }
  async listByFlow(flowId: string): Promise<Result<SessionStepOutput[]>> {
    return ok(this.rows.filter((row) => row.flowId === flowId));
  }
  async listBySession(sessionId: string): Promise<Result<SessionStepOutput[]>> {
    return ok(this.rows.filter((row) => row.sessionId === sessionId));
  }
}

class InMemoryMessages implements ISessionMessageRepository {
  rows: SessionMessage[] = [];
  private seq = 0;
  async create(input: NewSessionMessage): Promise<Result<SessionMessage>> {
    const message: SessionMessage = {
      id: `msg-${(this.seq += 1)}`,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      senderUserId: input.senderUserId ?? null,
      confidence: input.confidence ?? null,
      stepNodeId: input.stepNodeId ?? null,
      document: input.document ?? null,
      documentStatus: input.documentStatus ?? null,
      aiPayload: input.aiPayload ?? null,
      createdAt: new Date(Date.now() + this.seq),
    };
    this.rows.push(message);
    return ok(message);
  }
  async findById(id: string): Promise<Result<SessionMessage | null>> {
    return ok(this.rows.find((row) => row.id === id) ?? null);
  }
  async listBySession(sessionId: string): Promise<Result<SessionMessage[]>> {
    return ok(this.rows.filter((row) => row.sessionId === sessionId));
  }
  async updateDocument(): Promise<Result<SessionMessage>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async updateDocumentStatus(): Promise<Result<SessionMessage>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async updateAiPayload(): Promise<Result<SessionMessage>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
}

class RecordingAuditLogger implements IAuditLogger {
  entries: NewAuditLog[] = [];
  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.entries.push(payload);
    return ok(true as const);
  }
}

class RecordingNotifier implements IApprovalDecidedNotifier {
  calls: NotifyOnApprovalDecidedInput[] = [];
  async execute(input: NotifyOnApprovalDecidedInput): Promise<Result<NotificationLog | null>> {
    this.calls.push(input);
    return ok(null);
  }
}

class RecordingWithdrawnNotifier implements IApprovalWithdrawnNotifier {
  calls: NotifyOnApprovalWithdrawnInput[] = [];
  async execute(input: NotifyOnApprovalWithdrawnInput): Promise<Result<NotificationLog | null>> {
    this.calls.push(input);
    return ok(null);
  }
}

class RecordingReassignedNotifier implements IApprovalReassignedNotifier {
  calls: NotifyOnApprovalReassignedInput[] = [];
  async execute(input: NotifyOnApprovalReassignedInput): Promise<Result<NotificationLog | null>> {
    this.calls.push(input);
    return ok(null);
  }
}

class RecordingRequestedNotifier implements IApprovalRequestedNotifier {
  calls: NotifyOnApprovalRequestedInput[] = [];
  async execute(input: NotifyOnApprovalRequestedInput): Promise<Result<NotificationLog | null>> {
    this.calls.push(input);
    return ok(null);
  }
}

// Runs the work against the same in-memory repositories the test inspects, and
// counts invocations so a test can assert the approval update and session write
// went through one transaction. Rollback semantics live in the adapter's test.
class FakeUnitOfWork implements IUnitOfWork {
  transactionCount = 0;
  constructor(private readonly repositories: TransactionalRepositories) {}
  async withTransaction<T>(
    work: (repositories: TransactionalRepositories) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    this.transactionCount++;
    return work(this.repositories);
  }
}

const unitOfWorkFor = (approvals: IApprovalRepository, sessions: ISessionRepository) =>
  new FakeUnitOfWork({ approvals, sessions, sessionMessages: new InMemoryMessages() });

const approvalNode = (overrides: Partial<FlowNode> = {}): FlowNode => ({
  id: "node-appr",
  flowId: "flow-1",
  type: "approval",
  name: "Manager sign-off",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: { approverSource: "first_level_supervisor" },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const user = (id: string, email: string): User => ({
  id,
  email,
  name: id,
  role: null,
  team: null,
  isAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "operator-1",
  status: "active",
  title: "A session",
  currentNodeId: "node-appr",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("SuggestApprover", () => {
  it("suggests the first-level supervisor from the resolver and writes a pending row", async () => {
    const approvals = new InMemoryApprovals();
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode());
    const users = new InMemoryUsers();
    users.add(user("manager-1", "manager@corp.test"));
    const resolver = new StubResolver({ suggestedApproverUserId: "manager-1" });
    const sut = new SuggestApprover(approvals, nodes, resolver, users);

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.approval.status).toBe("pending");
    expect(result.data?.approval.suggestedApproverUserId).toBe("manager-1");
    expect(result.data?.suggestedApprover?.email).toBe("manager@corp.test");
  });

  it("is idempotent — reaching the node twice returns the same pending row", async () => {
    const approvals = new InMemoryApprovals();
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode());
    const sut = new SuggestApprover(
      approvals,
      nodes,
      new StubResolver({ unresolved: true }),
      new InMemoryUsers(),
    );
    const input = {
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    };

    const first = await sut.execute(input);
    const second = await sut.execute(input);

    expect(first.data?.approval.id).toBe(second.data?.approval.id);
    expect(approvals.rows.size).toBe(1);
  });

  it("leaves the suggestion empty when the chain is unresolved", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode());
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      new StubResolver({ unresolved: true }),
      new InMemoryUsers(),
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.data?.approval.suggestedApproverUserId).toBeNull();
    expect(result.data?.suggestedApprover).toBeNull();
  });

  it("for dynamic, suggests the single unambiguous position holder", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "SES Band 1" } }));
    const users = new InMemoryUsers();
    users.add(user("delegate-1", "delegate@corp.test"));
    const holder: Person = {
      source: "entra",
      directoryId: "d1",
      userId: "delegate-1",
      displayName: "Del Egate",
      email: "delegate@corp.test",
      jobTitle: "SES Band 1",
      department: "Policy",
    };
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      new StubResolver({ unresolved: true }, [holder]),
      users,
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.data?.approval.suggestedApproverUserId).toBe("delegate-1");
  });

  it("dynamic: uses the RAG-extracted role to call findPositionHolder when chunks are found", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "the delegate" } }));
    const users = new InMemoryUsers();
    users.add(user("cfo-1", "cfo@corp.test"));
    const holder: Person = {
      source: "hr",
      directoryId: "h1",
      userId: "cfo-1",
      displayName: "Casey FO",
      email: "cfo@corp.test",
      jobTitle: "Chief Financial Officer",
      department: "Finance",
    };
    const resolver = new StubResolver({ unresolved: true }, [holder]);
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      resolver,
      users,
      new StubEmbeddings(),
      new StubDocumentChunks([policyChunk("Spend above $1m is approved by the Chief Financial Officer.")]),
      new StubLanguageModel({ role: "Chief Financial Officer" }),
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(resolver.lastLookup?.role).toBe("Chief Financial Officer");
    expect(result.data?.approval.suggestedApproverUserId).toBe("cfo-1");
  });

  it("dynamic: falls back to roleHint when no chunks are retrieved", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "SES Band 2" } }));
    const resolver = new StubResolver({ unresolved: true }, []);
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      resolver,
      new InMemoryUsers(),
      new StubEmbeddings(),
      new StubDocumentChunks([]),
      new StubLanguageModel({ role: "should not be used" }),
    );

    await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(resolver.lastLookup?.role).toBe("SES Band 2");
  });

  it("dynamic: falls back to roleHint when LLM extraction returns an empty object", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "SES Band 2" } }));
    const resolver = new StubResolver({ unresolved: true }, []);
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      resolver,
      new InMemoryUsers(),
      new StubEmbeddings(),
      new StubDocumentChunks([policyChunk("Delegations are listed in the schedule.")]),
      new StubLanguageModel({}),
    );

    await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(resolver.lastLookup?.role).toBe("SES Band 2");
  });

  it("rejects a node that is not an approval node", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ type: "conversational" }));
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      new StubResolver({ unresolved: true }),
      new InMemoryUsers(),
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("ConfirmAndSend", () => {
  const seedPending = async (approvals: InMemoryApprovals) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      suggestedApproverUserId: "manager-1",
    });
    return created.data!;
  };

  it("persists a confirmed approver and audits the request", async () => {
    const approvals = new InMemoryApprovals();
    const audit = new RecordingAuditLogger();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, audit);

    const result = await sut.execute({
      approvalId: approval.id,
      approverUserId: "manager-1",
      isOverride: false,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.approverUserId).toBe("manager-1");
    expect(audit.entries.map((entry) => entry.action)).toContain("approval.requested");
  });

  it("accepts a free-typed email and records the override flag", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({
      approvalId: approval.id,
      approverEmail: "someone@external.test",
      isOverride: true,
    });

    expect(result.data?.approverEmail).toBe("someone@external.test");
    expect(result.data?.isOverride).toBe(true);
  });

  it("rejects sending with no approver chosen", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({ approvalId: approval.id, isOverride: false });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("persists the originator's message to the approver", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({
      approvalId: approval.id,
      approverUserId: "manager-1",
      isOverride: false,
      requestMessage: "Numbers are from the June forecast — signing before Friday would help.",
    });

    expect(result.data?.requestMessage).toContain("June forecast");
  });

  // Blank is not a message. Storing "" would put an empty block in the email
  // and an empty panel in the approver's view.
  it("stores a blank message as null", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({
      approvalId: approval.id,
      approverUserId: "manager-1",
      isOverride: false,
      requestMessage: "   ",
    });

    expect(result.data?.requestMessage).toBeNull();
  });

  it("leaves the message null when none was written", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({
      approvalId: approval.id,
      approverUserId: "manager-1",
      isOverride: false,
    });

    expect(result.data?.requestMessage).toBeNull();
  });
});

describe("DecideApproval", () => {
  const seedConfirmed = async (
    approvals: InMemoryApprovals,
    overrides: Partial<NewApproval> = {},
  ) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
      ...overrides,
    });
    return created.data!;
  };

  it("approves, snapshots, and advances along the single outgoing edge", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const stepOutputs = new InMemoryStepOutputs();
    const audit = new RecordingAuditLogger();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      edges,
      stepOutputs,
      audit,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
      comment: "Looks good",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-next");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-next");
    // Decision projected onto the node's step-output metadata for reporting.
    const projected = stepOutputs.rows.find((row) => row.nodeId === "node-appr");
    expect(projected?.fields.find((f) => f.key === "outcome")?.value).toBe("approved");
  });

  it("commits the approval update and the session advance through one transaction", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const unitOfWork = new FakeUnitOfWork({
      approvals,
      sessions,
      sessionMessages: new InMemoryMessages(),
    });
    const sut = new DecideApproval(
      unitOfWork,
      approvals,
      sessions,
      edges,
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.error).toBeUndefined();
    // Decision and advance are one atomic unit — a single transaction carries both.
    expect(unitOfWork.transactionCount).toBe(1);
    expect(approvals.rows.get(approval.id)?.status).toBe("approved");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-next");
  });

  it("completes the session when the approval node has no outgoing edge", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.data?.sessionCompleted).toBe(true);
    expect(sessions.rows.get("session-1")?.status).toBe("complete");
  });

  const checkpointedSession = () =>
    session({ graphCheckpoint: { currentNodeId: "node-appr", advancedFrom: "node-prev" } });

  it("changes_requested: routes the session back to the previous node and notifies the originator", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const notifier = new RecordingNotifier();
    const { nodes, stepOutputs } = await routableFlow();
    const sut = routingSut({ approvals, sessions, nodes, stepOutputs, notifier });

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "changes_requested",
      comment: "Please revise section 2",
    });

    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
    expect(approvals.rows.get(approval.id)?.comment).toBe("Please revise section 2");
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.routedBack).toBe(true);
    expect(result.data?.advanced).toBe(true);
  });

  // A flow of `Prepare instrument (conversational) → Manager review (approval)`
  // where the conversational step has run — the ordinary shape a change request
  // has to return to.
  const routableFlow = async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
    nodes.add(
      approvalNode({ id: "node-prev", type: "conversational", name: "Prepare instrument" }),
    );
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-prev",
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
    });
    return { nodes, stepOutputs };
  };

  const routingSut = (parts: {
    approvals: InMemoryApprovals;
    sessions: InMemorySessions;
    nodes: InMemoryFlowNodes;
    stepOutputs: InMemoryStepOutputs;
    messages?: InMemoryMessages;
    notifier?: RecordingNotifier;
  }) =>
    new DecideApproval(
      unitOfWorkFor(parts.approvals, parts.sessions),
      parts.approvals,
      parts.sessions,
      new InMemoryFlowEdges(),
      parts.stepOutputs,
      new RecordingAuditLogger(),
      parts.notifier,
      parts.messages ?? new InMemoryMessages(),
      new InMemoryUsers(),
      parts.nodes,
    );

  it("changes_requested: returns to the nearest editable step", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const { nodes, stepOutputs } = await routableFlow();
    const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "changes_requested",
      comment: "Revise",
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-prev");
    expect(result.data?.sessionCompleted).toBe(false);
  });

  it("rejected + routeBack: routes the session back to the nearest editable step", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const { nodes, stepOutputs } = await routableFlow();
    const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: true,
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
  });

  it("rejected + routeBack:false: cancels the session and notifies the originator", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const notifier = new RecordingNotifier();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      notifier,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: false,
    });

    expect(result.data?.advanced).toBe(false);
    expect(result.data?.sessionCompleted).toBe(true);
    expect(sessions.rows.get("session-1")?.status).toBe("cancelled");
    expect(notifier.calls[0]?.routedBack).toBe(false);
  });

  describe("change-request routing", () => {
    it("holds the session when no return target resolves, and never cancels it", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(session({ graphCheckpoint: null }));
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
      const messages = new InMemoryMessages();
      const sut = routingSut({
        approvals,
        sessions,
        nodes,
        stepOutputs: new InMemoryStepOutputs(),
        messages,
      });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.advanced).toBe(false);
      expect(sessions.rows.get("session-1")?.status).toBe("active");
      expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
      const decisionMessage = messages.rows.find((row) => row.role === "user");
      expect(decisionMessage?.content).toContain("no step to return to");
    });

    it("holds rather than cancels when a rejection asks to route back and cannot", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(session({ graphCheckpoint: null }));
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
      const sut = routingSut({
        approvals,
        sessions,
        nodes,
        stepOutputs: new InMemoryStepOutputs(),
      });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "rejected",
        routeBack: true,
      });

      expect(result.data?.sessionCompleted).toBe(false);
      expect(sessions.rows.get("session-1")?.status).toBe("active");
    });

    it("returns to the step the author named, not the nearest editable one", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { stepOutputs } = await routableFlow();
      await stepOutputs.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-intake",
        fields: [],
      });
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-intake", type: "conversational", name: "Gather" }));
      nodes.add(approvalNode({ id: "node-prev", type: "conversational", name: "Prepare" }));
      nodes.add(
        approvalNode({
          id: "node-appr",
          name: "Manager review",
          config: {
            approverSource: "first_level_supervisor",
            changesRequestedTarget: { kind: "step", nodeId: "node-intake" },
          },
        }),
      );
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(result.data?.newNodeId).toBe("node-intake");
    });

    it("holds when the named target has been deleted from the flow", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { stepOutputs } = await routableFlow();
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-prev", type: "conversational", name: "Prepare" }));
      nodes.add(
        approvalNode({
          id: "node-appr",
          name: "Manager review",
          config: {
            approverSource: "first_level_supervisor",
            changesRequestedTarget: { kind: "step", nodeId: "node-deleted" },
          },
        }),
      );
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(result.data?.advanced).toBe(false);
      expect(sessions.rows.get("session-1")?.status).toBe("active");
    });

    it("skips a preceding approval, which has nothing an operator can change", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals, { nodeId: "node-appr-b" });
      const sessions = new InMemorySessions();
      sessions.add(
        session({ graphCheckpoint: { currentNodeId: "node-appr-b", advancedFrom: "node-appr" } }),
      );
      const { nodes, stepOutputs } = await routableFlow();
      nodes.add(approvalNode({ id: "node-appr-b", name: "Finance review" }));
      await stepOutputs.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-appr",
        fields: [{ key: "outcome", label: "Outcome", type: "text", value: "approved" }],
      });
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(result.data?.newNodeId).toBe("node-prev");
    });

    // The build before ADR-044 wrote `advancedFrom: null` on route-back, so
    // `routeBackOrCancel` found no previous node the second time and cancelled
    // the session outright.
    it("routes two change requests in a row, instead of cancelling on the second", async () => {
      const approvals = new InMemoryApprovals();
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { nodes, stepOutputs } = await routableFlow();
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const first = await seedConfirmed(approvals);
      const firstResult = await sut.execute({
        approvalId: first.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      // The operator makes the changes and reaches the approval again, raising a
      // new row — a decided approval is never reopened (ADR-044 §5).
      const second = await seedConfirmed(approvals);
      const secondResult = await sut.execute({
        approvalId: second.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(firstResult.data?.newNodeId).toBe("node-prev");
      expect(secondResult.data?.newNodeId).toBe("node-prev");
      expect(sessions.rows.get("session-1")?.status).toBe("active");
    });

    it("keeps the approval node on the checkpoint rather than blanking it", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { nodes, stepOutputs } = await routableFlow();
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
      });

      expect(sessions.rows.get("session-1")?.graphCheckpoint).toEqual({
        currentNodeId: "node-prev",
        advancedFrom: "node-appr",
      });
    });

    it("still cancels on an explicit reject-and-close", async () => {
      const approvals = new InMemoryApprovals();
      const approval = await seedConfirmed(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointedSession());
      const { nodes, stepOutputs } = await routableFlow();
      const sut = routingSut({ approvals, sessions, nodes, stepOutputs });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "rejected",
        routeBack: false,
      });

      expect(result.data?.sessionCompleted).toBe(true);
      expect(sessions.rows.get("session-1")?.status).toBe("cancelled");
    });
  });

  it("rejects a second decision on an already-decided approval", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );
    await sut.execute({ approvalId: approval.id, decidedByUserId: "manager-1", decision: "approved" });

    const second = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
    });

    expect(second.error?.code).toBe("VALIDATION_FAILED");
  });

  it("forbids a decision by anyone other than the confirmed approver", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "intruder-1",
      decision: "approved",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("forbids deciding an email-assigned approval when the decider's email does not match", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, {
      approverUserId: null,
      approverEmail: "manager@corp.test",
    });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const users = new InMemoryUsers();
    users.add(user("intruder-1", "intruder@corp.test"));
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      undefined,
      users,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "intruder-1",
      decision: "approved",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("allows deciding an email-assigned approval when the decider's email matches (case-insensitively)", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, {
      approverUserId: null,
      approverEmail: "manager@corp.test",
    });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const users = new InMemoryUsers();
    users.add(user("manager-1", "Manager@Corp.test"));
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      undefined,
      users,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.sessionCompleted).toBe(true);
  });

  it("lets an admin decide an email-assigned approval regardless of email", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, {
      approverUserId: null,
      approverEmail: "manager@corp.test",
    });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      undefined,
      new InMemoryUsers(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "some-admin",
      decision: "approved",
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
  });

  it("does not run decision side effects when a concurrent decider already won the race", async () => {
    class RaceLostApprovals extends InMemoryApprovals {
      async updateIfPending(): Promise<Result<Approval | null>> {
        return ok(null);
      }
    }
    const approvals = new RaceLostApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const audit = new RecordingAuditLogger();
    const notifier = new RecordingNotifier();
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      edges,
      new InMemoryStepOutputs(),
      audit,
      notifier,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(audit.entries).toHaveLength(0);
    expect(notifier.calls).toHaveLength(0);
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
  });

  it("writes a chat message recording the decision and comment", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
      comment: "Looks good",
    });

    const decisionMessage = messages.rows.find((row) => row.role === "user");
    expect(decisionMessage?.content).toContain("Approval granted.");
    expect(decisionMessage?.content).toContain("Looks good");
    expect(decisionMessage?.stepNodeId).toBe("node-appr");
  });

  // The decision is the approver's, so the thread records it as theirs: it reads
  // as their message rather than the assistant's, and it joins the transcript the
  // model reasons over instead of sitting outside it as a system aside.
  it("attributes the decision message to the approver who made it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const users = new InMemoryUsers();
    users.add({ ...user("manager-1", "rosa.okafor@example.com"), name: "Rosa Okafor" });
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
      users,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    const decisionMessage = messages.rows.find((row) => row.role === "user");
    expect(decisionMessage?.senderUserId).toBe("manager-1");
    expect(decisionMessage?.content).toContain("Rosa Okafor");
    expect(decisionMessage?.content).toContain("rosa.okafor@example.com");
  });

  // No system-role row is written at all, so a decision can never leave a
  // mid-conversation system message for the next turn to hand to the model.
  it("writes no system-role message for a decision", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(messages.rows.filter((row) => row.role === "system")).toHaveLength(0);
  });

  it("records a routed-back message when a rejection routes back to the originator", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session({ graphCheckpoint: { currentNodeId: "node-appr", advancedFrom: "node-prev" } }));
    const messages = new InMemoryMessages();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: true,
      comment: "Not yet",
    });

    const decisionMessage = messages.rows.find((row) => row.role === "user");
    expect(decisionMessage?.content).toContain("routed back to the originator");
  });

  describe("record locked at decision time", () => {
    const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

    const buildRecording = (parts: {
      approvals: InMemoryApprovals;
      sessions: InMemorySessions;
      nodes: InMemoryFlowNodes;
      stepOutputs?: InMemoryStepOutputs;
      messages?: InMemoryMessages;
      users?: InMemoryUsers;
      applySignature?: { execute: (input: { approvalId: string }) => Promise<unknown> };
    }) => {
      const stepOutputs = parts.stepOutputs ?? new InMemoryStepOutputs();
      const messages = parts.messages ?? new InMemoryMessages();
      const users = parts.users ?? new InMemoryUsers();
      const subject = new ResolveApprovalSubject(
        parts.approvals,
        parts.nodes,
        stepOutputs,
        messages,
      );
      return new DecideApproval(
        unitOfWorkFor(parts.approvals, parts.sessions),
        parts.approvals,
        parts.sessions,
        new InMemoryFlowEdges(),
        stepOutputs,
        new RecordingAuditLogger(),
        undefined,
        messages,
        users,
        parts.nodes,
        sha256Hex,
        subject,
        parts.applySignature as never,
      );
    };

    const seedFlow = async () => {
      const approvals = new InMemoryApprovals();
      const sessions = new InMemorySessions();
      sessions.add(session());
      const nodes = new InMemoryFlowNodes();
      nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
      nodes.add(approvalNode({ id: "node-draft", type: "conversational", name: "Prepare instrument" }));
      const stepOutputs = new InMemoryStepOutputs();
      await stepOutputs.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-draft",
        fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
      });
      const users = new InMemoryUsers();
      users.add({ ...user("manager-1", "manager@corp.test"), name: "Jane Doe" });
      return { approvals, sessions, nodes, stepOutputs, users };
    };

    it("writes the five guaranteed keys, prefixed by the step key", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
        comment: "Within delegated authority.",
      });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record["manager_review.decision"]).toBe("approved");
      expect(record["manager_review.approver_name"]).toBe("Jane Doe");
      expect(record["manager_review.approver_email"]).toBe("manager@corp.test");
      expect(record["manager_review.decided_at"]).toEqual(expect.any(String));
      expect(record["manager_review.comment"]).toBe("Within delegated authority.");
    });

    it("copies the approver's name and does not re-read it after a rename", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });
      users.add({ ...user("manager-1", "new@corp.test"), name: "Jane Married" });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record["manager_review.approver_name"]).toBe("Jane Doe");
      expect(record["manager_review.approver_email"]).toBe("manager@corp.test");
    });

    it("locks the resolved subject into the record", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record["manager_review.subject_description"]).toContain("Prepare instrument");
      expect(record["manager_review.subject_node_id"]).toBe("node-draft");
    });

    it("does not change the record when the session continues past the approval", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });
      const locked = { ...approvals.rows.get(approval.id)!.recordSnapshot! };

      // The session carries on and the draft step captures a different value.
      await stepOutputs.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-draft",
        fields: [{ key: "amount", label: "Amount", type: "text", value: "$9,999" }],
      });

      expect(approvals.rows.get(approval.id)!.recordSnapshot).toEqual(locked);
    });

    it("gives two approval steps non-colliding key sets", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      nodes.add(approvalNode({ id: "node-appr-2", name: "Finance review" }));
      const first = await seedConfirmed(approvals);
      const second = await seedConfirmed(approvals, { nodeId: "node-appr-2" });
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({ approvalId: first.id, decidedByUserId: "manager-1", decision: "approved" });
      await sut.execute({
        approvalId: second.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      const firstKeys = Object.keys(approvals.rows.get(first.id)!.recordSnapshot!);
      const secondKeys = Object.keys(approvals.rows.get(second.id)!.recordSnapshot!);
      expect(firstKeys).toContain("manager_review.decision");
      expect(secondKeys).toContain("finance_review.decision");
      expect(secondKeys).not.toContain("manager_review.decision");
    });

    it("suffixes the key when two approval steps share a label", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      nodes.add(approvalNode({ id: "node-appr-2", name: "Manager review" }));
      const second = await seedConfirmed(approvals, { nodeId: "node-appr-2" });
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: second.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      expect(approvals.rows.get(second.id)!.recordSnapshot).toHaveProperty(
        "manager_review_2.decision",
      );
    });

    it("records a change request too, so every decision leaves a trail", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "changes_requested",
        comment: "Fix the date.",
      });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record["manager_review.decision"]).toBe("changes_requested");
      expect(record["manager_review.comment"]).toBe("Fix the date.");
    });

    describe("projected onto step outputs for the insights report", () => {
      const projected = (stepOutputs: InMemoryStepOutputs, key: string): string | undefined =>
        stepOutputs.rows
          .find((row) => row.nodeId === "node-appr" && row.fields.some((f) => f.key === "outcome"))
          ?.fields.find((f) => f.key === key)?.value;

      it("names the approver rather than projecting their user id", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(projected(stepOutputs, "decided_by")).toBe("Jane Doe");
        expect(projected(stepOutputs, "approver_email")).toBe("manager@corp.test");
      });

      it("projects what the approval applies to", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(projected(stepOutputs, "applies_to")).toContain("Prepare instrument");
      });

      it("falls back to the approver's email when no name was recorded", async () => {
        const { approvals, sessions, nodes, stepOutputs } = await seedFlow();
        const users = new InMemoryUsers();
        users.add({ ...user("manager-1", "manager@corp.test"), name: null });
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(projected(stepOutputs, "decided_by")).toBe("manager@corp.test");
      });

      // The record's dependencies are optional, so an unwired decision path still
      // has to project something that identifies the decider — a blank cell in a
      // governance report is worse than a raw id.
      it("falls back to the decider's user id when the record carries no identity", async () => {
        const approvals = new InMemoryApprovals();
        const approval = await seedConfirmed(approvals);
        const sessions = new InMemorySessions();
        sessions.add(session());
        const stepOutputs = new InMemoryStepOutputs();
        const sut = new DecideApproval(
          unitOfWorkFor(approvals, sessions),
          approvals,
          sessions,
          new InMemoryFlowEdges(),
          stepOutputs,
          new RecordingAuditLogger(),
        );

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(projected(stepOutputs, "decided_by")).toBe("manager-1");
        expect(projected(stepOutputs, "approver_email")).toBe("");
        expect(projected(stepOutputs, "applies_to")).toBe("");
      });

      // A change request routes work back; re-entering the step raises a fresh
      // request, so one approval step holds several decisions. The report reads
      // the latest projected row, and the revision says how many passes it took.
      it("numbers each pass, so a re-decided step reports its revision", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        const first = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: first.id,
          decidedByUserId: "manager-1",
          decision: "changes_requested",
          comment: "Fix the date.",
        });

        const second = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: second.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const projections = stepOutputs.rows.filter(
          (row) => row.nodeId === "node-appr" && row.fields.some((f) => f.key === "outcome"),
        );
        expect(projections).toHaveLength(2);
        expect(projections[0]!.fields.find((f) => f.key === "revision")?.value).toBe("1");
        expect(projections[0]!.fields.find((f) => f.key === "outcome")?.value).toBe(
          "changes_requested",
        );
        expect(projections[1]!.fields.find((f) => f.key === "revision")?.value).toBe("2");
        expect(projections[1]!.fields.find((f) => f.key === "outcome")?.value).toBe("approved");
      });

      // Nothing caps the count: a step can go back and round as many times as
      // the work needs, and each pass numbers itself.
      it("keeps numbering past a second pass", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        for (const decision of ["changes_requested", "rejected", "changes_requested"] as const) {
          const pass = await seedConfirmed(approvals);
          await sut.execute({ approvalId: pass.id, decidedByUserId: "manager-1", decision });
        }
        const final = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: final.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const revisions = stepOutputs.rows
          .filter((row) => row.nodeId === "node-appr" && row.fields.some((f) => f.key === "outcome"))
          .map((row) => row.fields.find((f) => f.key === "revision")?.value);
        expect(revisions).toEqual(["1", "2", "3", "4"]);

        const latest = stepOutputs.rows
          .filter((row) => row.nodeId === "node-appr" && row.fields.some((f) => f.key === "outcome"))
          .at(-1);
        expect(latest?.fields.find((f) => f.key === "outcome")?.value).toBe("approved");
      });

      it("numbers a first-pass decision as revision 1", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(projected(stepOutputs, "revision")).toBe("1");
      });

      // Two approval steps each count their own passes — a second sign-off on
      // its first pass is revision 1, however many times the first was decided.
      it("counts passes per approval step, not per session", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        nodes.add(approvalNode({ id: "node-appr-2", name: "Finance review" }));
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        const first = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: first.id,
          decidedByUserId: "manager-1",
          decision: "changes_requested",
        });
        const retry = await seedConfirmed(approvals);
        await sut.execute({
          approvalId: retry.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });
        const other = await seedConfirmed(approvals, { nodeId: "node-appr-2" });
        await sut.execute({
          approvalId: other.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const financeProjection = stepOutputs.rows.find(
          (row) => row.nodeId === "node-appr-2" && row.fields.some((f) => f.key === "outcome"),
        );
        expect(financeProjection?.fields.find((f) => f.key === "revision")?.value).toBe("1");
      });

      it("keeps the outcome, timestamp and comment the report already reads", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
          comment: "Within delegated authority.",
        });

        expect(projected(stepOutputs, "outcome")).toBe("approved");
        expect(projected(stepOutputs, "comment")).toBe("Within delegated authority.");
        expect(projected(stepOutputs, "decided_at")).toEqual(expect.any(String));
      });

    });

    it("freezes the attestation block when the node targets a signature slot", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      nodes.add(
        approvalNode({
          id: "node-appr",
          name: "Manager review",
          config: {
            approverSource: "first_level_supervisor",
            signatureFieldKey: "delegate_signature",
          },
        }),
      );
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
        comment: "Signed off.",
      });

      const record = approvals.rows.get(approval.id)!.recordSnapshot!;
      expect(record.signatureFieldKey).toBe("delegate_signature");
      expect(record.attestationText).toContain("Jane Doe");
      expect(record.attestationText).toContain("Approved");
      expect(record["manager_review.verification_code"]).toMatch(/^[0-9A-F]{12}$/);
    });

    it("triggers the document re-render after the decision commits", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const applied: string[] = [];
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({
        approvals,
        sessions,
        nodes,
        stepOutputs,
        users,
        applySignature: {
          execute: async (input) => {
            applied.push(input.approvalId);
            return ok({ applied: false, reason: "no_signature_slot" });
          },
        },
      });

      await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      expect(applied).toEqual([approval.id]);
    });

    describe("approved_with_edits", () => {
      // A document on the subject step whose edit history the derivation reads.
      const seedEditedDocument = async (
        messages: InMemoryMessages,
        edits: Array<{ editedByUserId: string; editedAt: string; keys: string[] }>,
      ) => {
        await messages.create({
          sessionId: "session-1",
          role: "assistant",
          content: "Here is the draft.",
          stepNodeId: "node-draft",
          document: {
            filename: "instrument.docx",
            storagePath: "generated/session-1/instrument-r1.docx",
            summary: null,
            generatedAt: "2026-08-01T11:00:00.000Z",
            editHistory: edits.map((edit) => ({
              editedAt: edit.editedAt,
              editedByUserId: edit.editedByUserId,
              storagePath: "generated/session-1/instrument-r1.docx",
              changes: edit.keys.map((key) => ({ key, previousValue: "a", newValue: "b" })),
            })),
          },
        });
      };

      const decideWith = async (
        edits: Array<{ editedByUserId: string; editedAt: string; keys: string[] }>,
        decision: "approved" | "rejected" = "approved",
      ) => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const messages = new InMemoryMessages();
        await seedEditedDocument(messages, edits);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users, messages });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision,
          routeBack: true,
        });

        return approvals.rows.get(approval.id)!;
      };

      const laterThanRaise = new Date(Date.now() + 60_000).toISOString();
      const beforeRaise = new Date(Date.now() - 60_000).toISOString();

      // The report reads the projection, not the approval row, so the widened
      // status has to reach both or "approved after the approver changed it"
      // is invisible to the very report it was derived for (ADR-045 §4).
      it("projects the widened status onto the step outputs too", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const messages = new InMemoryMessages();
        await seedEditedDocument(messages, [
          { editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["commencement_date"] },
        ]);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users, messages });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const row = stepOutputs.rows.find(
          (candidate) =>
            candidate.nodeId === "node-appr" &&
            candidate.fields.some((f) => f.key === "outcome"),
        );
        expect(row?.fields.find((f) => f.key === "outcome")?.value).toBe("approved_with_edits");
      });

      it("records approved_with_edits when the approver edited their own subject step", async () => {
        const decided = await decideWith([
          { editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["commencement_date"] },
        ]);

        expect(decided.status).toBe("approved_with_edits");
        expect(decided.recordSnapshot!["manager_review.decision"]).toBe("approved_with_edits");
        expect(decided.recordSnapshot!["manager_review.edits_made"]).toBe(true);
        expect(decided.recordSnapshot!["manager_review.edited_field_keys"]).toEqual([
          "commencement_date",
        ]);
      });

      it("records plain approved when the approver changed nothing", async () => {
        const decided = await decideWith([]);

        expect(decided.status).toBe("approved");
        expect(decided.recordSnapshot!["manager_review.edits_made"]).toBe(false);
      });

      it("does not count the originator's edits", async () => {
        const decided = await decideWith([
          { editedByUserId: "operator-1", editedAt: laterThanRaise, keys: ["amount"] },
        ]);

        expect(decided.status).toBe("approved");
      });

      it("does not count another approver's edits", async () => {
        const decided = await decideWith([
          { editedByUserId: "finance-1", editedAt: laterThanRaise, keys: ["amount"] },
        ]);

        expect(decided.status).toBe("approved");
      });

      it("does not count the same person's edits made before the approval was raised", async () => {
        const decided = await decideWith([
          { editedByUserId: "manager-1", editedAt: beforeRaise, keys: ["amount"] },
        ]);

        expect(decided.status).toBe("approved");
      });

      it("says so in the thread the originator is watching", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const messages = new InMemoryMessages();
        await seedEditedDocument(messages, [
          { editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["amount"] },
        ]);
        const sut = buildRecording({ approvals, sessions, nodes, stepOutputs, users, messages });

        await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        const decisionMessage = messages.rows.find(
          (row) => row.role === "user" && row.content.includes("Approval granted"),
        );
        expect(decisionMessage?.content).toContain("edits made by the approver");
      });

      it("never widens a rejection", async () => {
        const decided = await decideWith(
          [{ editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["amount"] }],
          "rejected",
        );

        expect(decided.status).toBe("rejected");
      });

      // A regression guard: control flow reads `input.decision`, which keeps its
      // three values, so the widened status must not change advancement at all.
      it("advances the session exactly as a plain approval does", async () => {
        const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
        const approval = await seedConfirmed(approvals);
        const messages = new InMemoryMessages();
        await seedEditedDocument(messages, [
          { editedByUserId: "manager-1", editedAt: laterThanRaise, keys: ["amount"] },
        ]);
        const edges = new InMemoryFlowEdges();
        edges.rows.push({
          id: "edge-1",
          flowId: "flow-1",
          fromNodeId: "node-appr",
          toNodeId: "node-next",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const sut = new DecideApproval(
          unitOfWorkFor(approvals, sessions),
          approvals,
          sessions,
          edges,
          stepOutputs,
          new RecordingAuditLogger(),
          undefined,
          messages,
          users,
          nodes,
          sha256Hex,
          new ResolveApprovalSubject(approvals, nodes, stepOutputs, messages),
        );

        const result = await sut.execute({
          approvalId: approval.id,
          decidedByUserId: "manager-1",
          decision: "approved",
        });

        expect(approvals.rows.get(approval.id)!.status).toBe("approved_with_edits");
        expect(result.data?.advanced).toBe(true);
        expect(result.data?.newNodeId).toBe("node-next");
        expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-next");
      });
    });

    it("keeps the decision when the re-render fails", async () => {
      const { approvals, sessions, nodes, stepOutputs, users } = await seedFlow();
      const approval = await seedConfirmed(approvals);
      const sut = buildRecording({
        approvals,
        sessions,
        nodes,
        stepOutputs,
        users,
        applySignature: {
          execute: async () => {
            throw new Error("object storage unavailable");
          },
        },
      });

      const result = await sut.execute({
        approvalId: approval.id,
        decidedByUserId: "manager-1",
        decision: "approved",
      });

      expect(result.error).toBeUndefined();
      expect(approvals.rows.get(approval.id)!.status).toBe("approved");
      expect(approvals.rows.get(approval.id)!.recordSnapshot).toBeTruthy();
    });
  });
});

describe("WithdrawApproval", () => {
  const seedSent = async (
    approvals: InMemoryApprovals,
    overrides: Partial<NewApproval> = {},
  ) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      suggestedApproverUserId: "manager-1",
      approverUserId: "manager-1",
      ...overrides,
    });
    return created.data!;
  };

  // `Prepare instrument (conversational) → Manager review (approval)`, with the
  // conversational step already run — the shape a withdrawal has to return to.
  const withdrawableFlow = async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
    nodes.add(
      approvalNode({ id: "node-prev", type: "conversational", name: "Prepare instrument" }),
    );
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-prev",
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
    });
    return { nodes, stepOutputs };
  };

  const withdrawSut = (parts: {
    approvals: InMemoryApprovals;
    sessions: InMemorySessions;
    nodes: InMemoryFlowNodes;
    stepOutputs: InMemoryStepOutputs;
    messages?: InMemoryMessages;
    users?: InMemoryUsers;
    audit?: RecordingAuditLogger;
    unitOfWork?: IUnitOfWork;
  }) =>
    new WithdrawApproval(
      parts.unitOfWork ?? unitOfWorkFor(parts.approvals, parts.sessions),
      parts.approvals,
      parts.sessions,
      parts.stepOutputs,
      parts.audit ?? new RecordingAuditLogger(),
      parts.messages ?? new InMemoryMessages(),
      parts.users ?? new InMemoryUsers(),
      parts.nodes,
    );

  it("records the withdrawal and returns the session to the nearest conversational step", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.returnedToNodeId).toBe("node-prev");
    expect(result.data?.held).toBe(false);
    expect(approvals.rows.get(approval.id)?.status).toBe("withdrawn");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
  });

  it("audits the withdrawal", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const audit = new RecordingAuditLogger();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs, audit });

    await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
      reason: "Figures were stale",
    });

    const entry = audit.entries.find((row) => row.action === "approval.withdrawn");
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe("operator-1");
    expect(entry?.resourceId).toBe(approval.id);
  });

  it("posts the withdrawal into the session thread, naming the step returned to", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const messages = new InMemoryMessages();
    const users = new InMemoryUsers();
    users.add(user("operator-1", "dana@corp.test"));
    users.add(user("manager-1", "rosa@corp.test"));
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs, messages, users });

    await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
      reason: "Figures were stale",
    });

    const posted = messages.rows.at(-1);
    expect(posted?.content).toContain("withdrawn");
    expect(posted?.content).toContain("Prepare instrument");
    expect(posted?.content).toContain("Figures were stale");
    // The originator's own message, not a system aside — matching how a
    // decision is written into the thread.
    expect(posted?.role).toBe("user");
    expect(posted?.senderUserId).toBe("operator-1");
  });

  it("lets an admin withdraw a request they did not raise", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "admin-9",
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
    expect(approvals.rows.get(approval.id)?.status).toBe("withdrawn");
  });

  it("refuses a withdrawal by anyone other than the originator or an admin", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "manager-1",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(approvals.rows.get(approval.id)?.status).toBe("pending");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
  });

  it("refuses to withdraw an approval that has already been decided", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals, { status: "approved" });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
  });

  it("reports NOT_FOUND for an approval that does not exist", async () => {
    const approvals = new InMemoryApprovals();
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    const result = await sut.execute({
      approvalId: "appr-missing",
      withdrawnByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  // ADR-044 §3: a routing gap holds the session, it never cancels it. An
  // approval with no conversational step before it is exactly that gap.
  it("holds the session on the approval node when no conversational step precedes it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ id: "node-appr", name: "Manager review" }));
    const messages = new InMemoryMessages();
    const sut = withdrawSut({
      approvals,
      sessions,
      nodes,
      stepOutputs: new InMemoryStepOutputs(),
      messages,
    });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.held).toBe(true);
    expect(result.data?.returnedToNodeId).toBeNull();
    // The withdrawal still stands, and the session is held rather than cancelled.
    expect(approvals.rows.get(approval.id)?.status).toBe("withdrawn");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
    expect(messages.rows.at(-1)?.content).toContain("no earlier chat step");
  });

  // The status flip and the session move must commit together, or a crash
  // between them leaves a withdrawn row on a session that never moved.
  it("puts the status change and the session move in one transaction", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const unitOfWork = unitOfWorkFor(approvals, sessions);
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs, unitOfWork });

    await sut.execute({ approvalId: approval.id, withdrawnByUserId: "operator-1" });

    expect((unitOfWork as FakeUnitOfWork).transactionCount).toBe(1);
  });

  // A decision landing first wins: `updateIfPending` returns null, the whole
  // transaction fails, and no side effect runs on a row someone else decided.
  it("loses cleanly to a decision that lands first, leaving no trace", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const messages = new InMemoryMessages();
    const audit = new RecordingAuditLogger();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs, messages, audit });

    // The approver decides in the window between the guard read and the write.
    await approvals.update(approval.id, { status: "approved", decidedByUserId: "manager-1" });

    const result = await sut.execute({
      approvalId: approval.id,
      withdrawnByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(approvals.rows.get(approval.id)?.status).toBe("approved");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
    expect(messages.rows).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
  });

  it("notifies the approver that the request was pulled", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const notifier = new RecordingWithdrawnNotifier();
    const sut = new WithdrawApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      stepOutputs,
      new RecordingAuditLogger(),
      new InMemoryMessages(),
      new InMemoryUsers(),
      nodes,
      notifier,
    );

    await sut.execute({ approvalId: approval.id, withdrawnByUserId: "operator-1" });

    // Fire-and-forget, so let the microtask queue drain before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.approval.id).toBe(approval.id);
  });

  // The row leaves `pending`, so it leaves the approver's queue by the same
  // filter that drops a decided one. Nothing new is needed for that; this
  // guards it against a regression.
  it("drops the request out of the approver's pending queue", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    await sut.execute({ approvalId: approval.id, withdrawnByUserId: "operator-1" });

    const queue = await approvals.listPendingForApprover({
      approverUserId: "manager-1",
      approverEmail: null,
    });
    expect(queue.data).toHaveLength(0);
  });

  // Re-entering the node raises a fresh row rather than reopening the withdrawn
  // one, exactly as ADR-044 §5 specifies for re-approval after changes.
  it("leaves the node free to raise a fresh request", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedSent(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const { nodes, stepOutputs } = await withdrawableFlow();
    const sut = withdrawSut({ approvals, sessions, nodes, stepOutputs });

    await sut.execute({ approvalId: approval.id, withdrawnByUserId: "operator-1" });

    const stillPending = await approvals.findPendingByNode("session-1", "node-appr");
    expect(stillPending.data).toBeNull();
  });
});

describe("ReassignApproval", () => {
  // The chained shape this exists for: the row for the second approval is
  // raised by the *first approver*, who nominates the next signer from their
  // decision modal (ADR-018, v0.22.2). So `requestedByUserId` is them, not the
  // chat's author — and the author is the one who needs to move it.
  const seedChained = async (
    approvals: InMemoryApprovals,
    overrides: Partial<NewApproval> = {},
  ) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "approver-a",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
      requestMessage: "Board meets Thursday.",
      ...overrides,
    });
    return created.data!;
  };

  const reassignSut = (parts: {
    approvals: InMemoryApprovals;
    sessions: InMemorySessions;
    users?: InMemoryUsers;
    messages?: InMemoryMessages;
    audit?: RecordingAuditLogger;
    reassigned?: RecordingReassignedNotifier;
    requested?: RecordingRequestedNotifier;
  }) =>
    new ReassignApproval(
      parts.approvals,
      parts.sessions,
      parts.audit ?? new RecordingAuditLogger(),
      parts.messages ?? new InMemoryMessages(),
      parts.users ?? new InMemoryUsers(),
      parts.reassigned,
      parts.requested,
    );

  const withUsers = () => {
    const users = new InMemoryUsers();
    users.add(user("operator-1", "dana@corp.test"));
    users.add(user("manager-1", "rosa@corp.test"));
    users.add(user("manager-2", "sam@corp.test"));
    users.add(user("approver-a", "alex@corp.test"));
    return users;
  };

  it("moves an open request to a new approver at the session owner's request", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.approval.approverUserId).toBe("manager-2");
    expect(result.data?.previousApproverUserId).toBe("manager-1");
    // Still open, and still on the same node — reassigning is not a withdrawal.
    expect(approvals.rows.get(approval.id)?.status).toBe("pending");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
  });

  it("accepts a free-typed address and records the override", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverEmail: "external@partner.test",
      isOverride: true,
    });

    expect(result.data?.approval.approverEmail).toBe("external@partner.test");
    expect(result.data?.approval.approverUserId).toBeNull();
    expect(result.data?.approval.isOverride).toBe(true);
  });

  it("lets an admin reassign a session they do not own", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "admin-9",
      approverUserId: "manager-2",
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
    expect(approvals.rows.get(approval.id)?.approverUserId).toBe("manager-2");
  });

  // Gated on the session owner, not the requester: on a chained row the
  // requester is the previous approver, and the person who needs this is the
  // one watching the chat.
  it("refuses a reassignment by someone who neither owns the session nor is an admin", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "manager-1",
      approverUserId: "manager-2",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(approvals.rows.get(approval.id)?.approverUserId).toBe("manager-1");
  });

  it("refuses to reassign an approval that has already been decided", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals, { status: "approved" });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a reassignment with no approver chosen", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("reports NOT_FOUND for an approval that does not exist", async () => {
    const approvals = new InMemoryApprovals();
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: "appr-missing",
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  // The audit answer to the question that put in-place reassignment out of
  // scope in v0.25.0: the trail names who moved it, from whom, to whom.
  it("audits the move with both approver identities", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const audit = new RecordingAuditLogger();
    const sut = reassignSut({ approvals, sessions, users: withUsers(), audit });

    await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    const entry = audit.entries.find((row) => row.action === "approval.reassigned");
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe("operator-1");
    expect(entry?.metadata).toMatchObject({
      previousApproverUserId: "manager-1",
      approverUserId: "manager-2",
    });
  });

  it("announces the move in the session thread", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const sut = reassignSut({ approvals, sessions, users: withUsers(), messages });

    await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    const posted = messages.rows.at(-1);
    expect(posted?.content).toContain("reassigned");
    expect(posted?.content).toContain("sam@corp.test");
    expect(posted?.content).toContain("rosa@corp.test");
  });

  it("tells the previous approver they are off it, and the new one they are on it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const reassigned = new RecordingReassignedNotifier();
    const requested = new RecordingRequestedNotifier();
    const sut = reassignSut({
      approvals,
      sessions,
      users: withUsers(),
      reassigned,
      requested,
    });

    await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reassigned.calls).toHaveLength(1);
    expect(reassigned.calls[0]?.previousApproverUserId).toBe("manager-1");
    expect(requested.calls).toHaveLength(1);
    expect(requested.calls[0]?.approval.approverUserId).toBe("manager-2");
  });

  it("carries the originator's message across unchanged when none is supplied", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.data?.approval.requestMessage).toBe("Board meets Thursday.");
  });

  // A note naming the old approver would read oddly to the new one, so the
  // panel offers it for revision and a supplied value replaces it.
  it("replaces the message when the operator revises it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
      requestMessage: "Rosa is on leave — over to you, Sam.",
    });

    expect(result.data?.approval.requestMessage).toBe("Rosa is on leave — over to you, Sam.");
  });

  it("clears the message when the operator empties it", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
      requestMessage: "   ",
    });

    expect(result.data?.approval.requestMessage).toBeNull();
  });

  // The row stays pending but stops matching the old approver, so it leaves
  // their queue by the same filter that serves it.
  it("moves the request between the two approvers' queues", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = reassignSut({ approvals, sessions, users: withUsers() });

    await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    const oldQueue = await approvals.listPendingForApprover({
      approverUserId: "manager-1",
      approverEmail: null,
    });
    const newQueue = await approvals.listPendingForApprover({
      approverUserId: "manager-2",
      approverEmail: null,
    });
    expect(oldQueue.data).toHaveLength(0);
    expect(newQueue.data).toHaveLength(1);
  });

  // A decision landing first wins: `updateIfPending` returns null and the move
  // is refused rather than rewriting the approver on a decided row.
  it("loses cleanly to a decision that lands first", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedChained(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const audit = new RecordingAuditLogger();
    const sut = reassignSut({ approvals, sessions, users: withUsers(), messages, audit });

    await approvals.update(approval.id, { status: "approved", decidedByUserId: "manager-1" });

    const result = await sut.execute({
      approvalId: approval.id,
      reassignedByUserId: "operator-1",
      approverUserId: "manager-2",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(approvals.rows.get(approval.id)?.approverUserId).toBe("manager-1");
    expect(messages.rows).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
  });
});

describe("ListApprovals", () => {
  it("returns only the pending approvals for the given approver", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    const other = await approvals.create({
      sessionId: "session-2",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-2",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-2",
    });
    await approvals.update(other.data!.id, { status: "approved" });
    const sut = new ListApprovals(approvals);

    const result = await sut.execute({
      approverUserId: "manager-1",
      approverEmail: null,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.approverUserId).toBe("manager-1");
  });

  it("matches approvals routed only by email so the recipient can claim them", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverEmail: "manager@corp.test",
    });
    const sut = new ListApprovals(approvals);

    const result = await sut.execute({
      approverUserId: "manager-1",
      approverEmail: "manager@corp.test",
    });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.approverEmail).toBe("manager@corp.test");
  });

  // Regression guard: the originator discarded the chat, but the approval it
  // raised stayed in the approver's queue awaiting a decision that could no
  // longer do anything.
  it("hides an approval whose session was discarded", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    approvals.sessionStatuses.set("session-1", "abandoned");
    const sut = new ListApprovals(approvals);

    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data).toEqual([]);
  });

  it("hides an approval whose session a rejection cancelled", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    approvals.sessionStatuses.set("session-1", "cancelled");
    const sut = new ListApprovals(approvals);

    expect((await sut.execute({ approverUserId: "manager-1", approverEmail: null })).data).toEqual(
      [],
    );
  });

  it("keeps an approval on a completed session", async () => {
    // `complete` is not `discarded`: the approvals are what completed it.
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    approvals.sessionStatuses.set("session-1", "complete");
    const sut = new ListApprovals(approvals);

    expect((await sut.execute({ approverUserId: "manager-1", approverEmail: null })).data).toHaveLength(
      1,
    );
  });
});

describe("ListApprovalsWithContext", () => {
  const previousNode = (overrides: Partial<FlowNode> = {}): FlowNode =>
    approvalNode({ id: "node-prev", type: "conversational", name: "Draft the memo", ...overrides });

  const checkpointed = () =>
    session({ graphCheckpoint: { currentNodeId: "node-appr", advancedFrom: "node-prev" } });

  const seedPending = async (approvals: InMemoryApprovals) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    return created.data!;
  };

  const build = (parts: {
    approvals: InMemoryApprovals;
    sessions?: InMemorySessions;
    users?: InMemoryUsers;
    messages?: InMemoryMessages;
    stepOutputs?: InMemoryStepOutputs;
    nodes?: InMemoryFlowNodes;
  }) => {
    const messages = parts.messages ?? new InMemoryMessages();
    const stepOutputs = parts.stepOutputs ?? new InMemoryStepOutputs();
    const nodes = parts.nodes ?? new InMemoryFlowNodes();
    // The real resolver, not a stub — the context and the gate must resolve the
    // subject the same way, and a stub here would hide it if they stopped.
    const subject = new ResolveApprovalSubject(parts.approvals, nodes, stepOutputs, messages);
    return new ListApprovalsWithContext(
      parts.approvals,
      parts.sessions ?? new InMemorySessions(),
      parts.users ?? new InMemoryUsers(),
      messages,
      stepOutputs,
      nodes,
      subject,
    );
  };

  it("enriches a pending approval with chat name and originator", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const users = new InMemoryUsers();
    users.add({ ...user("operator-1", "operator@corp.test"), name: "Olivia Operator" });

    const sut = build({ approvals, sessions, users });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.chatName).toBe("A session");
    expect(result.data?.[0]?.originatorName).toBe("Olivia Operator");
    expect(result.data?.[0]?.originatorEmail).toBe("operator@corp.test");
  });

  // The approver must be able to see which stage of the chain they are — "first
  // supervisor" and "second supervisor" are different jobs, and a queue that
  // names neither leaves them guessing.
  it("names the approval step and its role hint", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const nodes = new InMemoryFlowNodes();
    nodes.add(
      approvalNode({
        name: "Second level endorsement",
        config: { approverSource: "second_level_supervisor", roleHint: "SES Band 1 delegate" },
      }),
    );

    const sut = build({ approvals, sessions, nodes });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data?.[0]?.approvalStepName).toBe("Second level endorsement");
    expect(result.data?.[0]?.roleHint).toBe("SES Band 1 delegate");
  });

  it("falls back to a generic step name when the approval node has gone", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());

    const sut = build({ approvals, sessions });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data?.[0]?.approvalStepName).toBe("Approval");
    expect(result.data?.[0]?.roleHint).toBeNull();
  });

  it("surfaces the previous step's document as the key output", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const nodes = new InMemoryFlowNodes();
    nodes.add(previousNode());
    const messages = new InMemoryMessages();
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "Here is the draft.",
      stepNodeId: "node-prev",
      document: {
        filename: "memo.docx",
        storagePath: "s/memo.docx",
        summary: "A memo",
        generatedAt: new Date().toISOString(),
      },
      aiPayload: {
        response: "Here is the draft.",
        rationale: "",
        stepCompleteConfidence: 95,
        contextGathered: [],
        documentGenerationConfidence: {
          guidanceAlignmentConfidence: 90,
          guidanceAlignmentRationale: "Aligned",
          criteriaAlignmentConfidence: 88,
          criteriaAlignmentRationale: "On criteria",
        },
      },
    });

    const sut = build({ approvals, sessions, messages, nodes });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    const previous = result.data?.[0]?.previousStep;
    expect(previous?.stepName).toBe("Draft the memo");
    expect(previous?.document?.document.filename).toBe("memo.docx");
    expect(previous?.document?.documentGenerationConfidence?.guidanceAlignmentConfidence).toBe(90);
    expect(previous?.fields).toBeNull();
  });

  it("falls back to the previous step's output fields when there is no document", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-prev",
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
    });

    const sut = build({ approvals, sessions, stepOutputs });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    const previous = result.data?.[0]?.previousStep;
    expect(previous?.document).toBeNull();
    expect(previous?.fields?.[0]?.value).toBe("$1,200");
  });

  it("returns a null previous step when nothing has completed yet", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session({ graphCheckpoint: null }));

    const sut = build({ approvals, sessions });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data?.[0]?.previousStep).toBeNull();
  });

  it("carries the statement of what is being approved", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const nodes = new InMemoryFlowNodes();
    nodes.add(previousNode());
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-prev",
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
    });

    const sut = build({ approvals, sessions, stepOutputs, nodes });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data?.[0]?.subjectDescription).toContain("Draft the memo");
  });

  // The defect ADR-040 §2 exists to close: `advancedFrom` names approval A when
  // the session advances from it, so B used to be shown A's decision fields.
  it("shows a second approver the document, not the first approval's decision fields", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr-b",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    const sessions = new InMemorySessions();
    sessions.add(
      session({ graphCheckpoint: { currentNodeId: "node-appr-b", advancedFrom: "node-appr-a" } }),
    );
    const nodes = new InMemoryFlowNodes();
    nodes.add(previousNode());
    nodes.add(approvalNode({ id: "node-appr-a", name: "Manager review" }));
    nodes.add(approvalNode({ id: "node-appr-b", name: "Finance review" }));

    const messages = new InMemoryMessages();
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "Here is the draft.",
      stepNodeId: "node-prev",
      document: {
        filename: "memo.docx",
        storagePath: "s/memo-r2.docx",
        summary: "A memo",
        generatedAt: new Date().toISOString(),
      },
    });
    // Approval A's projected decision output — the thing B must not be shown.
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr-a",
      fields: [{ key: "outcome", label: "Outcome", type: "text", value: "approved" }],
    });

    const sut = build({ approvals, sessions, messages, stepOutputs, nodes });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    const previous = result.data?.[0]?.previousStep;
    expect(previous?.nodeId).toBe("node-prev");
    expect(previous?.document?.document.storagePath).toBe("s/memo-r2.docx");
    expect(previous?.fields).toBeNull();
  });

  describe("history", () => {
    const decide = async (
      approvals: InMemoryApprovals,
      approvalId: string,
      patch: { status: ApprovalStatus; decidedByUserId: string },
    ) => {
      await approvals.update(approvalId, { ...patch, decidedAt: new Date() });
    };

    it("returns a decision the approver made but is no longer assigned to", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      await decide(approvals, raised.id, { status: "approved", decidedByUserId: "manager-1" });
      // Reassigned afterwards — the decision is still manager-1's.
      await approvals.update(raised.id, { approverUserId: "manager-9" });
      const sessions = new InMemorySessions();
      sessions.add(checkpointed());

      const sut = build({ approvals, sessions });
      const result = await sut.execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "decided",
      });

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.approval.status).toBe("approved");
    });

    it("names who decided it, and leaves that null while pending", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointed());
      const users = new InMemoryUsers();
      users.add({ ...user("manager-1", "manager@corp.test"), name: "Mo Manager" });

      const pending = await build({ approvals, sessions, users }).execute({
        approverUserId: "manager-1",
        approverEmail: null,
      });
      expect(pending.data?.[0]?.decidedByName).toBeNull();

      await decide(approvals, raised.id, { status: "approved", decidedByUserId: "manager-1" });
      const decided = await build({ approvals, sessions, users }).execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "decided",
      });
      expect(decided.data?.[0]?.decidedByName).toBe("Mo Manager");
    });

    // A decision is only half the story: the approver needs to know whether
    // what they signed went on to complete, was sent back, or was discarded.
    it("reports where the session has since got to", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      await decide(approvals, raised.id, { status: "approved", decidedByUserId: "manager-1" });
      const sessions = new InMemorySessions();
      sessions.add({ ...checkpointed(), status: "complete", currentNodeId: "node-prev" });
      const nodes = new InMemoryFlowNodes();
      nodes.add(previousNode());

      const sut = build({ approvals, sessions, nodes });
      const result = await sut.execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "decided",
      });

      expect(result.data?.[0]?.sessionState).toEqual({
        status: "complete",
        currentStepName: "Draft the memo",
      });
    });

    it("lists several decisions on one approval step as separate entries", async () => {
      // A change request routes work back; re-entering the node raises a fresh
      // row. Both rounds are the approver's history.
      const approvals = new InMemoryApprovals();
      const first = await seedPending(approvals);
      await decide(approvals, first.id, {
        status: "changes_requested",
        decidedByUserId: "manager-1",
      });
      const second = await seedPending(approvals);
      await decide(approvals, second.id, { status: "approved", decidedByUserId: "manager-1" });
      const sessions = new InMemorySessions();
      sessions.add(checkpointed());

      const sut = build({ approvals, sessions });
      const result = await sut.execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "decided",
      });

      expect(result.data).toHaveLength(2);
      expect(result.data?.map((entry) => entry.approval.status).sort()).toEqual([
        "approved",
        "changes_requested",
      ]);
    });

    it("keeps a decided approval visible after its session was discarded", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      await decide(approvals, raised.id, { status: "approved", decidedByUserId: "manager-1" });
      approvals.sessionStatuses.set("session-1", "abandoned");
      const sessions = new InMemorySessions();
      sessions.add({ ...checkpointed(), status: "abandoned" });

      const sut = build({ approvals, sessions });
      const result = await sut.execute({
        approverUserId: "manager-1",
        approverEmail: null,
        scope: "all",
      });

      // The decision stands as a matter of record; the state says what happened.
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.sessionState.status).toBe("abandoned");
    });
  });

  describe("getById", () => {
    it("returns the approval to the approver it was addressed to", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      const sessions = new InMemorySessions();
      sessions.add(checkpointed());

      const result = await build({ approvals, sessions }).getById({
        approvalId: raised.id,
        viewerUserId: "manager-1",
        viewerEmail: null,
        isAdmin: false,
      });

      expect(result.data?.approval.id).toBe(raised.id);
    });

    it("refuses a viewer the approval was not addressed to", async () => {
      // Being named on *another* approval of the session opens the session
      // (ADR-018), but not someone else's decision record.
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);

      const result = await build({ approvals }).getById({
        approvalId: raised.id,
        viewerUserId: "manager-2",
        viewerEmail: "other@corp.test",
        isAdmin: false,
      });

      expect(result.error?.code).toBe("FORBIDDEN");
    });

    it("allows an admin, and the person who decided it", async () => {
      const approvals = new InMemoryApprovals();
      const raised = await seedPending(approvals);
      await approvals.update(raised.id, {
        status: "approved",
        decidedByUserId: "admin-1",
        decidedAt: new Date(),
      });

      const asAdmin = await build({ approvals }).getById({
        approvalId: raised.id,
        viewerUserId: "someone-else",
        viewerEmail: null,
        isAdmin: true,
      });
      expect(asAdmin.error).toBeUndefined();

      const asDecider = await build({ approvals }).getById({
        approvalId: raised.id,
        viewerUserId: "admin-1",
        viewerEmail: null,
        isAdmin: false,
      });
      expect(asDecider.error).toBeUndefined();
    });

    it("matches an email-only assignment case-insensitively", async () => {
      const approvals = new InMemoryApprovals();
      const created = await approvals.create({
        sessionId: "session-1",
        flowId: "flow-1",
        nodeId: "node-appr",
        requestedByUserId: "operator-1",
        approverSource: "first_level_supervisor",
        approverEmail: "Manager@Corp.test",
      });

      const result = await build({ approvals }).getById({
        approvalId: created.data!.id,
        viewerUserId: "manager-1",
        viewerEmail: "manager@corp.test",
        isAdmin: false,
      });

      expect(result.error).toBeUndefined();
    });

    it("is NOT_FOUND for an approval that does not exist", async () => {
      const result = await build({ approvals: new InMemoryApprovals() }).getById({
        approvalId: "missing",
        viewerUserId: "manager-1",
        viewerEmail: null,
        isAdmin: true,
      });

      expect(result.error?.code).toBe("NOT_FOUND");
    });
  });
});
