import {
  ok,
  type AutoNodeConfig,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type NodeExecutionOutput,
  type PendingExecutions,
  type Result,
} from "@rbrasier/domain";
import { coerceStructuredFields } from "../document/structured-fields";

export interface ApplyAutoNodeResultInput {
  sessionId: string;
  correlationId?: string;
  nodeId: string;
  status: NodeExecutionOutput["status"];
  data: Record<string, unknown>;
  message?: string;
}

export interface ApplyAutoNodeResultOutput {
  applied: boolean;
  advanced: boolean;
}

const ignored: Result<ApplyAutoNodeResultOutput> = ok({ applied: false, advanced: false });

export class ApplyAutoNodeResult {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
  ) {}

  async execute(input: ApplyAutoNodeResultInput): Promise<Result<ApplyAutoNodeResultOutput>> {
    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) return ignored;
    const session = sessionResult.data;

    const correlationId = this.resolveCorrelationId(session.pendingExecutions, input);
    if (!correlationId) return ignored;

    const remaining = { ...session.pendingExecutions };
    delete remaining[correlationId];

    if (input.status !== "completed") {
      const cleared = await this.sessions.update(session.id, { pendingExecutions: remaining });
      if (cleared.error) return cleared;
      return ok({ applied: true, advanced: false });
    }

    await this.persistStepOutput(session.flowId, input);

    return this.advance(session.id, session.flowId, session.currentNodeId, input.nodeId, remaining);
  }

  private resolveCorrelationId(
    pending: PendingExecutions,
    input: ApplyAutoNodeResultInput,
  ): string | null {
    if (input.correlationId) {
      const entry = pending[input.correlationId];
      return entry && entry.nodeId === input.nodeId ? input.correlationId : null;
    }
    const match = Object.entries(pending).find(([, entry]) => entry.nodeId === input.nodeId);
    return match ? match[0] : null;
  }

  // Best-effort: a persist failure must not block the session from advancing,
  // mirroring the existing best-effort step-output capture in GenerateDocument.
  private async persistStepOutput(flowId: string, input: ApplyAutoNodeResultInput): Promise<void> {
    const nodeResult = await this.flowNodes.findById(input.nodeId);
    if (nodeResult.error || !nodeResult.data) return;

    const config = nodeResult.data.config as unknown as AutoNodeConfig;
    const responseFields = config.responseFields ?? [];
    const fields = coerceStructuredFields(responseFields, input.data);

    await this.sessionStepOutputs.create({
      sessionId: input.sessionId,
      flowId,
      nodeId: input.nodeId,
      messageId: null,
      fields,
    });
  }

  private async advance(
    sessionId: string,
    flowId: string,
    currentNodeId: string | null,
    nodeId: string,
    remaining: PendingExecutions,
  ): Promise<Result<ApplyAutoNodeResultOutput>> {
    const edgesResult = await this.flowEdges.listByFlow(flowId);
    if (edgesResult.error) return edgesResult;

    const outgoing = edgesResult.data.filter((edge) => edge.fromNodeId === nodeId);

    if (outgoing.length === 0) {
      const completed = await this.sessions.update(sessionId, {
        pendingExecutions: remaining,
        status: "complete",
      });
      if (completed.error) return completed;
      return ok({ applied: true, advanced: true });
    }

    // An auto callback cannot make an AI branch choice, so a fork is left at the
    // current node (observable via the cleared pending map) rather than guessed.
    if (outgoing.length > 1) {
      const cleared = await this.sessions.update(sessionId, { pendingExecutions: remaining });
      if (cleared.error) return cleared;
      return ok({ applied: true, advanced: false });
    }

    const newNodeId = outgoing[0]!.toNodeId;
    const updated = await this.sessions.update(sessionId, {
      pendingExecutions: remaining,
      currentNodeId: newNodeId,
      graphCheckpoint: { currentNodeId: newNodeId, advancedFrom: currentNodeId },
    });
    if (updated.error) return updated;
    return ok({ applied: true, advanced: true });
  }
}
