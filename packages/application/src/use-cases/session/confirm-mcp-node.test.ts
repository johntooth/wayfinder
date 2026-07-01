import { describe, expect, it, vi } from "vitest";
import { err, domainError, ok } from "@rbrasier/domain";
import type {
  FlowNode,
  IMcpClient,
  IMcpServerRepository,
  McpServer,
  Session,
} from "@rbrasier/domain";
import { ConfirmMcpNode } from "./confirm-mcp-node";

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "sess-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Create ticket",
  currentNodeId: "node-1",
  awaitingConfirmationNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions: {
    "corr-1": {
      nodeId: "node-1",
      status: "awaiting_confirmation",
      sentAt: "2026-06-30T00:00:00.000Z",
      args: { title: "Broken login" },
    },
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
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

const actionsServer: McpServer = {
  id: "mcp-1",
  label: "Jira",
  transport: "sse",
  kind: "actions",
  businessSelectable: false,
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

const makeClient = (overrides: Partial<IMcpClient> = {}): IMcpClient => ({
  listTools: vi.fn().mockResolvedValue(ok([])),
  callTool: vi.fn().mockResolvedValue(ok({ output: "ticket #42 created" })),
  ...overrides,
});

const config = { instruction: "x", serverId: "mcp-1", toolName: "create_ticket" };

describe("ConfirmMcpNode", () => {
  it("calls the tool with the parked args and returns its output", async () => {
    const client = makeClient();
    const result = await new ConfirmMcpNode(makeServers(actionsServer), client).execute({
      session: makeSession(),
      node: makeNode(config),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.correlationId).toBe("corr-1");
    expect(result.data?.status).toBe("completed");
    expect(result.data?.data).toEqual({ output: "ticket #42 created" });
    expect(client.callTool).toHaveBeenCalledWith(actionsServer, "create_ticket", { title: "Broken login" });
  });

  it("fails when there is no action awaiting confirmation for the node", async () => {
    const result = await new ConfirmMcpNode(makeServers(actionsServer), makeClient()).execute({
      session: makeSession({ pendingExecutions: {} }),
      node: makeNode(config),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("propagates a tool-call failure", async () => {
    const client = makeClient({
      callTool: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "unreachable"))),
    });
    const result = await new ConfirmMcpNode(makeServers(actionsServer), client).execute({
      session: makeSession(),
      node: makeNode(config),
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
