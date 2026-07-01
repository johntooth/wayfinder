import { err, type Flow, type IFlowRepository, type IMcpServerRepository, type Result } from "@rbrasier/domain";

// Replaces a flow's flow-wide `context` MCP server allow-list (ADR-032). Only
// active, `context`-kind servers are kept — an id for a missing, disabled, or
// `actions` server is dropped so a stale or mis-typed reference can never attach
// a write-capable server as ambient read-only context. When the caller is a
// business user without the `mcp` flag (`restrictToBusinessSelectable`), a server
// the admin has not opened up is dropped too — this is the authoritative guard, so
// a forged id from the client can never widen the caller's own allow-list.
export class SetFlowContextMcpServers {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly mcpServers: IMcpServerRepository,
  ) {}

  async execute(
    flowId: string,
    serverIds: string[],
    restrictToBusinessSelectable: boolean,
  ): Promise<Result<Flow>> {
    const serversResult = await this.mcpServers.list();
    if (serversResult.error) return err(serversResult.error);

    const selectableServerIds = new Set(
      serversResult.data
        .filter(
          (server) =>
            server.status === "active" &&
            server.kind === "context" &&
            (!restrictToBusinessSelectable || server.businessSelectable),
        )
        .map((server) => server.id),
    );
    const valid = serverIds.filter((id) => selectableServerIds.has(id));
    return this.flows.setContextMcpServers(flowId, valid);
  }
}
