# v1.56.0 — MCP Business-Selectable Whitelist

Enhancement on top of the MCP/Skills refactor (separate `mcp`/`skills` flags,
per-server `context`/`actions` split, flow-wide context servers, human-in-the-loop
action nodes). Addresses review feedback on PR #132: MCP servers are not uniform, so
a business user should be able to attach a safe one (e.g. a spellchecker) while a
sensitive one (e.g. database management) stays admin-controlled.

## What changed

A per-server governance axis, **independent of `kind`**: an admin registers every
server and marks which ones a plain business user may select into a flow. `kind`
(`context`/`actions`) says *what the server does*; `businessSelectable` says *who
may wire it in*. They correlate but are set independently.

- **Domain** — `McpServer.businessSelectable: boolean` (optional on `NewMcpServer` /
  `McpServerUpdate`), default `false`.
- **Application**
  - `ListSelectableContextMcpServers(canSelectAll)` — active `context` servers with
    tools; when `!canSelectAll`, only `businessSelectable` ones. `actions` servers
    are never returned.
  - `SetFlowContextMcpServers.execute(flowId, serverIds, restrictToBusinessSelectable)`
    — the authoritative guard: a restricted (business) caller has non-whitelisted
    ids dropped server-side, so a forged/stale id can never widen the allow-list.
- **Adapters** — `admin_mcp_servers.business_selectable boolean not null default
  false`; migration `0028_busy_mentor.sql`; repository mapping in
  `toEntity`/`create`/`update`.
- **API** — `mcpServer.register`/`update` accept `businessSelectable`; new
  `mcpServer.listContextForMe` resolves the caller's `mcp` flag →
  `ListSelectableContextMcpServers`; `flow.contextMcp.setServers` resolves the flag
  and passes `restrictToBusinessSelectable = !hasMcpFlag`.
- **UI** — `/admin/mcp-servers`: a "Business-user selectable" checkbox on the
  register form (context servers only) and a per-row toggle. Flow editor: the
  context-MCP picker sources from `listContextForMe` and the section now renders for
  a business user when at least one business-selectable context server exists.

## Governance

`businessSelectable` defaults to false — servers are admin-only until opened up.
`actions` servers are never business-selectable through this path. The business-user
filter is applied server-side in both the list query and the set-servers guard.

## Version

MINOR (1.55.0 → 1.56.0) — new column + migration + feature.

## Tests

- Unit (packages/application): `mcp.test.ts` (register/update `businessSelectable`
  passthrough; `ListSelectableContextMcpServers` — all vs whitelisted vs actions
  excluded vs error propagation) and `set-context-mcp-servers.test.ts` (restricted
  vs unrestricted guard). All 28 in-scope tests pass; `./validate.sh` green.
- E2E: `apps/web/e2e/enhance-mcp-business-selectable.spec.ts` covers the admin
  surface (register-form checkbox, Selectable column, toggle, actions exclusion).
  The downstream business-user picker filtering is enforced server-side and covered
  by the unit tests above, since the e2e harness carries a single admin role.
