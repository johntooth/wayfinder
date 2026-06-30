# Implementation Summary — MCP Integration, Phase 2a (v1.53.0)

Foundation and admin management for Model Context Protocol (MCP) servers — the
first half of Phase 2 of the Flow Skills & MCP PRD. Admins can register, manage,
and connection-test remote MCP servers, and the platform can discover their tools.

- **Version bump**: MINOR — `1.52.0` → `1.53.0` (new feature + `admin_mcp_servers`
  / `admin_mcp_tools` tables).
- **PRD**: `docs/development/prd/flow-skills-and-mcp.prd.md`
- **ADR**: `docs/development/adr/032-mcp-integration-and-tool-calling.adr.md`
- **Phase doc**: the MCP integration phase doc remains in `to-be-implemented/`
  with a status banner — Phase 2a is done; Phase 2b (flow consumption) is pending.

## What was built (Phase 2a)

- **Domain** — `McpServer`/`NewMcpServer`/`McpServerUpdate`/`McpTool`/`McpToolRef`/
  `McpServerWithTools` entities; `IMcpClient`, `IMcpServerRepository`,
  `IMcpServerDirectory` ports. Forward-looking config for 2b is also in place: the
  `"mcp"` `FlowNodeType`, `McpNodeConfig`, and `ConversationalNodeConfig.allowedMcpToolRefs`.
- **Adapter** — `admin_mcp_servers` + `admin_mcp_tools` tables;
  `DrizzleMcpServerRepository`; `AiSdkMcpClient` (Vercel AI SDK
  `experimental_createMCPClient`, SSE transport, env-referenced bearer credential);
  `McpServerDirectory` (lists active servers with their tools, tolerant of an
  unreachable server). The `flow_nodes.type` DB enum gained `mcp`.
- **Application** — `RegisterMcpServer`, `UpdateMcpServer`, `ListMcpServers`,
  `DisableMcpServer`, `EnableMcpServer`, `TestMcpServer` (connection test via the
  client), `ListMcpServersWithTools`. URL/label validation returns typed
  `VALIDATION_FAILED` errors.
- **API/wiring** — `mcpServer` tRPC router (admin-gated list/register/update/
  disable/enable/test + `listWithTools`); container registration of the repo,
  client, directory, and use-cases.
- **UI** — `/admin/mcp-servers` page (register, list, test, enable/disable) and a
  sidebar link.

## Files

**Created**
- `packages/domain/src/entities/mcp-server.ts`
- `packages/domain/src/ports/mcp-client.ts`, `mcp-server-repository.ts`,
  `mcp-server-directory.ts`
- `packages/adapters/src/repositories/drizzle-mcp-server-repository.ts`
- `packages/adapters/src/mcp/ai-sdk-mcp-client.ts`, `mcp-server-directory.ts`,
  `index.ts`
- `packages/application/src/use-cases/mcp/mcp.ts` (+ `.test.ts`, `index.ts`)
- `apps/web/src/server/routers/mcp-server.ts`
- `apps/web/src/app/(admin)/admin/mcp-servers/page.tsx` + `_content.tsx`
- `apps/web/e2e/phase-mcp-integration.spec.ts`

**Modified**
- `packages/domain/src/entities/flow-node.ts` (`mcp` type, `McpNodeConfig`,
  `allowedMcpToolRefs`), `.../entities/index.ts`, `.../ports/index.ts`
- `packages/adapters/src/db/schema/admin.ts` (MCP tables),
  `.../db/schema/wayfinder.ts` (flow_nodes type enum)
- `packages/adapters/src/repositories/index.ts`, `packages/adapters/src/index.ts`
- `packages/application/src/use-cases/index.ts`
- `apps/web/src/lib/container.ts`, `apps/web/src/server/router.ts`
- `apps/web/src/components/sidebar.tsx`
- `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx` and
  `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` (`RawNode` type widened
  to include `mcp`)
- `VERSION`, `package.json`

## Migrations

`admin_mcp_servers` and `admin_mcp_tools` added to the Drizzle schema; the
`flow_nodes.type` check constraint now allows `mcp`. Generate and apply a
migration (`pnpm --filter @rbrasier/adapters db:generate && db:migrate`) against a
running Postgres — not run in this environment (no DB).

## Tests

- Unit (vitest, run + passing): MCP management use-cases incl. validation,
  enable/disable visibility, and connection-test success/failure/not-found (8).
- E2E: `apps/web/e2e/phase-mcp-integration.spec.ts` — register, invalid-URL error,
  disable. Driven by the `/e2e` skill against a running stack; not executed here.

## Known limitations / deferred to Phase 2b

- **Flow consumption is not built yet.** The deterministic `mcp` node (canvas UI +
  `RunMcpNode` dispatch + ADR-020 persistence) and the conversational tool-loop
  (tool-calling in conversational steps bounded by `allowedMcpToolRefs`) are
  deferred. ADR-032 gates the tool-loop on a runtime spike (live LLM + live MCP
  server) that the build sandbox cannot run.
- Only SSE transport is supported (SDK 4.3.19's transport config); Streamable HTTP
  needs a custom transport.
- `AiSdkMcpClient` opens a client per call (no pooling) and surfaces tool
  `inputSchema` as null; the `admin_mcp_tools` cache table exists but is not yet
  populated (the directory lists live).
- Credentials use an env-referenced bearer token (`credentialRef` → env var); a
  richer secret store is a future option per ADR-032.
- `validate.sh` DB-dependent checks (drizzle) skip without `DATABASE_URL`.
