import { describe, expect, it } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  FlowNode,
  IFlowNodeRepository,
  ISessionMessageRepository,
  NewSessionMessage,
  SessionMessage,
  SessionSchedule,
} from "@rbrasier/domain";
import { NotifyScheduleFireHandler } from "./notify-schedule-fire-handler";

const makeSchedule = (overrides: Partial<SessionSchedule> = {}): SessionSchedule => ({
  id: "sched-1",
  sessionId: "sess-1",
  flowId: "flow-1",
  nodeId: "node-1",
  kind: "relative",
  spec: "30d",
  recurring: false,
  nextFireAt: new Date("2026-07-03T09:00:00.000Z"),
  lastFiredAt: null,
  occurrenceCount: 0,
  maxOccurrences: null,
  status: "active",
  payload: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeNode = (overrides: Partial<FlowNode> = {}): FlowNode =>
  ({ id: "node-1", flowId: "flow-1", type: "scheduled", name: "Follow-up reminder", config: {} } as FlowNode);

const makeMessageRepo = (
  createResult: () => ReturnType<ISessionMessageRepository["create"]> = async () =>
    ok({} as SessionMessage),
): { repo: ISessionMessageRepository; created: NewSessionMessage[] } => {
  const created: NewSessionMessage[] = [];
  const repo = {
    create: async (input: NewSessionMessage) => {
      created.push(input);
      return createResult();
    },
    findById: async () => ok(null),
    listBySession: async () => ok([]),
    updateDocument: async () => err(domainError("NOT_FOUND", "unused")),
    updateDocumentStatus: async () => err(domainError("NOT_FOUND", "unused")),
    updateAiPayload: async () => err(domainError("NOT_FOUND", "unused")),
  } as ISessionMessageRepository;
  return { repo, created };
};

const makeNodeRepo = (node: FlowNode | null = makeNode()): IFlowNodeRepository =>
  ({
    create: async () => err(domainError("NOT_FOUND", "unused")),
    findById: async () => ok(node),
    listByFlow: async () => ok([]),
    update: async () => err(domainError("NOT_FOUND", "unused")),
    updatePosition: async () => err(domainError("NOT_FOUND", "unused")),
    delete: async () => ok(true as const),
  }) as IFlowNodeRepository;

describe("NotifyScheduleFireHandler", () => {
  it("posts a system message naming the step and occurrence into the session", async () => {
    const { repo, created } = makeMessageRepo();
    const handler = new NotifyScheduleFireHandler(repo, makeNodeRepo());

    const result = await handler.fire(makeSchedule({ occurrenceCount: 2 }));

    expect(result.error).toBeUndefined();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      sessionId: "sess-1",
      role: "system",
      stepNodeId: "node-1",
    });
    expect(created[0]?.content).toContain("Follow-up reminder");
    expect(created[0]?.content).toContain("3");
  });

  it("still posts when the node name cannot be resolved", async () => {
    const { repo, created } = makeMessageRepo();
    const handler = new NotifyScheduleFireHandler(repo, makeNodeRepo(null));

    const result = await handler.fire(makeSchedule());

    expect(result.error).toBeUndefined();
    expect(created).toHaveLength(1);
  });

  it("returns the failure when the message cannot be written", async () => {
    const { repo } = makeMessageRepo(async () => err(domainError("INFRA_FAILURE", "db down")));
    const handler = new NotifyScheduleFireHandler(repo, makeNodeRepo());

    const result = await handler.fire(makeSchedule());

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
