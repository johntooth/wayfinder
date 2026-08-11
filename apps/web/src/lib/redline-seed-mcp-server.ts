import { ok, type McpServer, type Result } from "@rbrasier/domain";
import type { ListMcpServers, RegisterMcpServer } from "@rbrasier/application";

// Register the redline report tool server in Wayfinder.
//
// apps/redline-mcp is served over streamable HTTP; it is the report assembler's
// read surface over redline's own Postgres inside the same deployment. It sends
// nothing outside Wayfinder, so `communicatesExternally` is FALSE — invariant 7:
// `true` registers a server that is NOT selectable in flows
// (ResolveStepTools drops externally-communicating refs), which would make the
// assembler unbuildable.
//
// RegisterMcpServer always creates, so a bare call is not re-runnable. This is
// the list-then-create guard that makes a UAT bring-up scriptable rather than an
// admin click — matched on URL so a relabelled row is still recognised, and
// including disabled rows so a manually-disabled server is not silently
// duplicated.

export const REDLINE_MCP_SERVER_LABEL = "Redline report tools";
export const REDLINE_MCP_SERVER_URL = "http://redline-mcp:8930/mcp";

export interface SeedRedlineMcpServerDependencies {
  readonly registerMcpServer: RegisterMcpServer;
  readonly listMcpServers: ListMcpServers;
}

export interface SeedRedlineMcpServerOutcome {
  readonly server: McpServer;
  // False when the guard matched an existing registration and skipped the create.
  readonly created: boolean;
}

export const seedRedlineMcpServer = async (
  dependencies: SeedRedlineMcpServerDependencies,
): Promise<Result<SeedRedlineMcpServerOutcome>> => {
  const existing = await dependencies.listMcpServers.execute({ includeDisabled: true });
  if (existing.error) return existing;

  const match = existing.data.find((server) => server.url === REDLINE_MCP_SERVER_URL);
  if (match) return ok({ server: match, created: false });

  const registered = await dependencies.registerMcpServer.execute({
    label: REDLINE_MCP_SERVER_LABEL,
    url: REDLINE_MCP_SERVER_URL,
    transport: "streamable-http",
    communicatesExternally: false,
  });
  if (registered.error) return registered;

  return ok({ server: registered.data, created: true });
};
