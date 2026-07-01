import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import type {
  Flow,
  FlowNode,
  ILanguageModel,
  IMcpServerRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  McpServer,
  Session,
  SessionMessage,
} from "@rbrasier/domain";
import { PrepareMcpNode } from "./prepare-mcp-node";

const usage = { promptTokens: 1, completionTokens: 1, systemTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "sess-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Create ticket",
  currentNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeFlow = (): Flow => ({
  id: "flow-1",
  name: "Flow",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "user-1",
  status: "published",
  visibility: { kind: "private" },
  permissions: [],
  contextDocs: [],
  contextMcpServerIds: [],
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeNode = (config: Record<string, unknown>): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "mcp",
  name: "Create ticket",
  colour: null,
  positionX: 0,
  positionY: 0,
  config,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeMessages = (): SessionMessage[] => [
  { id: "m1", sessionId: "sess-1", role: "user", content: "raise a ticket", confidence: null, stepNodeId: "node-1", document: null, createdAt: new Date() },
];

const makeSessions = (session: Session): ISessionRepository =>
  ({
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(session)),
    listByUser: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn().mockImplementation(async (_id, patch) => ok({ ...session, ...patch })),
  }) as unknown as ISessionRepository;

const makeLanguageModel = (): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(ok({ object: { title: "Broken login" }, usage })),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

const makeStepOutputs = (): ISessionStepOutputRepository =>
  ({
    create: vi.fn(),
    listByFlow: vi.fn().mockResolvedValue(ok([])),
    listBySession: vi.fn().mockResolvedValue(ok([])),
  }) as unknown as ISessionStepOutputRepository;

const actionsServer: McpServer = {
  id: "mcp-1",
  label: "Jira",
  transport: "sse",
  kind: "actions",
  url: "https://mcp.example.com/sse",
  credentialRef: null,
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeServers = (server: McpServer | null): IMcpServerRepository =>
  ({
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(server)),
    list: vi.fn(),
    setStatus: vi.fn(),
  }) as unknown as IMcpServerRepository;

const baseConfig = {
  instruction: "Create a ticket for the reported issue.",
  serverId: "mcp-1",
  toolName: "create_ticket",
  requestFields: [{ key: "title", label: "Title", type: "text", optional: false, raw: "Title" }],
  responseFields: [{ key: "output", label: "Output", type: "text", optional: false, raw: "Output" }],
};

const clock = { generateCorrelationId: () => "corr-1", now: () => new Date("2026-06-30T00:00:00.000Z") };

describe("PrepareMcpNode", () => {
  it("resolves args and parks them as an awaiting_confirmation execution without calling any tool", async () => {
    const session = makeSession();
    const sessions = makeSessions(session);

    const result = await new PrepareMcpNode(
      sessions,
      makeLanguageModel(),
      makeServers(actionsServer),
      makeStepOutputs(),
      clock,
    ).execute({ session, flow: makeFlow(), node: makeNode(baseConfig), messages: makeMessages(), userId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(result.data?.toolName).toBe("create_ticket");
    expect(result.data?.serverLabel).toBe("Jira");
    expect(result.data?.args).toEqual({ title: "Broken login" });
    expect(sessions.update).toHaveBeenCalledWith("sess-1", {
      awaitingConfirmationNodeId: "node-1",
      pendingExecutions: {
        "corr-1": {
          nodeId: "node-1",
          status: "awaiting_confirmation",
          sentAt: "2026-06-30T00:00:00.000Z",
          args: { title: "Broken login" },
        },
      },
    });
  });

  it("fails when no server/tool is configured", async () => {
    const result = await new PrepareMcpNode(
      makeSessions(makeSession()),
      makeLanguageModel(),
      makeServers(actionsServer),
      makeStepOutputs(),
      clock,
    ).execute({ session: makeSession(), flow: makeFlow(), node: makeNode({ instruction: "x" }), messages: makeMessages(), userId: "user-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a disabled server", async () => {
    const result = await new PrepareMcpNode(
      makeSessions(makeSession()),
      makeLanguageModel(),
      makeServers({ ...actionsServer, status: "disabled" }),
      makeStepOutputs(),
      clock,
    ).execute({ session: makeSession(), flow: makeFlow(), node: makeNode(baseConfig), messages: makeMessages(), userId: "user-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
