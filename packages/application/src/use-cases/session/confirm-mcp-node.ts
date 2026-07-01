import {
  domainError,
  err,
  ok,
  type FlowNode,
  type IMcpClient,
  type IMcpServerRepository,
  type McpNodeConfig,
  type NodeExecutionOutput,
  type Result,
  type Session,
} from "@rbrasier/domain";

export interface ConfirmMcpNodeInput {
  session: Session;
  node: FlowNode;
}

export interface ConfirmMcpNodeOutput {
  correlationId: string;
  status: NodeExecutionOutput["status"];
  // The tool result under the `output` key, matching RunMcpNode so the caller
  // applies it through the shared ApplyAutoNodeResult path.
  data: Record<string, unknown>;
}

// The operator-Proceed half of an MCP action node (ADR-032). Reads the arguments
// PrepareMcpNode parked on the session, calls the tool for real, and returns the
// result for ApplyAutoNodeResult to persist and advance. Does not clear the
// awaiting flag or advance itself — the caller owns that so the confirmation and
// auto-advance side effects stay in one place.
export class ConfirmMcpNode {
  constructor(
    private readonly mcpServers: IMcpServerRepository,
    private readonly mcpClient: IMcpClient,
  ) {}

  async execute(input: ConfirmMcpNodeInput): Promise<Result<ConfirmMcpNodeOutput>> {
    const config = input.node.config as unknown as McpNodeConfig;

    const entry = Object.entries(input.session.pendingExecutions).find(
      ([, execution]) =>
        execution.nodeId === input.node.id && execution.status === "awaiting_confirmation",
    );
    if (!entry) {
      return err(domainError("VALIDATION_FAILED", "This step has no action awaiting confirmation."));
    }
    const [correlationId, execution] = entry;

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

    const called = await this.mcpClient.callTool(
      serverResult.data,
      config.toolName,
      execution.args ?? {},
    );
    if (called.error) return err(called.error);

    return ok({
      correlationId,
      status: "completed",
      data: { output: called.data.output },
    });
  }
}
