import {
  domainError,
  err,
  ok,
  type Flow,
  type FlowNode,
  type ILanguageModel,
  type IMcpServerRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type McpNodeConfig,
  type Result,
  type Session,
  type SessionMessage,
} from "@rbrasier/domain";
import { accumulateInsights } from "../../services/accumulate-insights";
import { resolveFieldValues } from "../../services/resolve-field-values";

export interface PrepareMcpNodeInput {
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
  userId: string;
}

export interface PrepareMcpNodeOutput {
  correlationId: string;
  toolName: string;
  serverLabel: string;
  // The resolved tool arguments, parked so the operator previews exactly what
  // will run when they confirm (ADR-032).
  args: Record<string, unknown>;
}

export interface PrepareMcpNodeClock {
  generateCorrelationId: () => string;
  now: () => Date;
}

const defaultClock: PrepareMcpNodeClock = {
  generateCorrelationId: () => globalThis.crypto.randomUUID(),
  now: () => new Date(),
};

const buildTranscript = (messages: SessionMessage[]): string =>
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n")
    .slice(0, 8000);

// The human-in-the-loop half of an MCP action node (ADR-032). Resolves the tool
// arguments exactly as RunMcpNode would, then — instead of calling the tool —
// parks them on the session as an `awaiting_confirmation` pending execution and
// flags the node on `awaitingConfirmationNodeId`. ConfirmMcpNode fires the actual
// call once the operator clicks Proceed.
export class PrepareMcpNode {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly languageModel: ILanguageModel,
    private readonly mcpServers: IMcpServerRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly clock: PrepareMcpNodeClock = defaultClock,
  ) {}

  async execute(input: PrepareMcpNodeInput): Promise<Result<PrepareMcpNodeOutput>> {
    const config = input.node.config as unknown as McpNodeConfig;

    if (!config.serverId || !config.toolName) {
      return err(domainError("VALIDATION_FAILED", "MCP node has no server or tool configured."));
    }

    const serverResult = await this.mcpServers.findById(config.serverId);
    if (serverResult.error) return err(serverResult.error);
    if (!serverResult.data) {
      return err(domainError("NOT_FOUND", "The MCP server for this step no longer exists."));
    }
    if (serverResult.data.status !== "active") {
      return err(domainError("VALIDATION_FAILED", "The MCP server for this step is disabled."));
    }

    const priorOutputs = await this.sessionStepOutputs.listBySession(input.session.id);
    const fieldsResult = await resolveFieldValues(this.languageModel, {
      fields: config.requestFields ?? [],
      valueSources: config.requestFieldValues ?? {},
      priorStepOutputs: priorOutputs.error ? [] : priorOutputs.data,
      insights: accumulateInsights(input.messages),
      transcript: buildTranscript(input.messages),
      contextDocs: input.flow.contextDocs,
      instruction: config.instruction,
      purpose: "mcpNodeFields",
      userId: input.userId,
      flowId: input.flow.id,
      sessionId: input.session.id,
    });
    if (fieldsResult.error) return err(fieldsResult.error);

    const correlationId = this.clock.generateCorrelationId();
    const sentAt = this.clock.now().toISOString();

    const recorded = await this.sessions.update(input.session.id, {
      awaitingConfirmationNodeId: input.node.id,
      pendingExecutions: {
        ...input.session.pendingExecutions,
        [correlationId]: {
          nodeId: input.node.id,
          status: "awaiting_confirmation",
          sentAt,
          args: fieldsResult.data,
        },
      },
    });
    if (recorded.error) return err(recorded.error);

    return ok({
      correlationId,
      toolName: config.toolName,
      serverLabel: serverResult.data.label,
      args: fieldsResult.data,
    });
  }
}
