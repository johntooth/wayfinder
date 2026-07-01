# Phase — MCP Business-Selectable Whitelist

> Enhancement on top of the MCP/Skills refactor (separate `mcp`/`skills` flags,
> per-server `context`/`actions` split, flow-wide context servers, human-in-the-loop
> action nodes). Adds a finer governance control requested in review of PR #132.

- **PRD**: `docs/development/prd/flow-skills-and-mcp.prd.md`
- **ADR**: `docs/development/adr/032-mcp-integration-and-tool-calling.adr.md`
- **Target version**: 1.56.0 (MINOR — new column + migration + feature).

## Why

Today MCP is gated by the `mcp` feature flag, which is scoped to the **Power User**
role (`seed-roles.ts` + flag-role allowlist). A plain business user therefore sees
no MCP at all — `mcpEnabled` is false in the flow editor, so the context-MCP picker
never renders.

Review feedback: MCP servers are not uniform. A spellchecker is safe for any
business user to attach; a database-management server must stay admin-controlled.
The current all-or-nothing, role-level gate cannot express this.

This phase adds a **per-server governance axis, independent of `kind`**: the admin
registers every server and marks which ones a business user is allowed to select.
`kind` (`context`/`actions`) says *what the server does*; `businessSelectable` says
*who may wire it into a flow*. The two correlate but are set independently, so an
admin can keep a read-only server that touches sensitive data admin-only.

## Scope

- Business users may select **only** `context`-kind servers that are
  `businessSelectable`. Actions servers stay power-user/admin (unchanged; they run
  through the confirmed action node).
- Power users / admins keep the existing behaviour: all active `context` servers.
- Enforcement is server-authoritative: a forged/stale server id from a business
  user is dropped, never attached.

## Sub-components (build in order — tests before implementation each)

1. **Domain** — add `readonly businessSelectable: boolean` to `McpServer`; optional
   `businessSelectable?` on `NewMcpServer` and `McpServerUpdate` (default false, the
   safe closed classification). Add `businessSelectableOnly?: boolean` to
   `ListMcpServersInput`.
2. **Application** —
   - New `ListSelectableContextMcpServers` use-case: given `canSelectAll: boolean`,
     return active `context` servers-with-tools; when `!canSelectAll`, keep only
     `businessSelectable` ones.
   - Guard `SetFlowContextMcpServers.execute(flowId, serverIds, restrictToBusinessSelectable)`:
     when restricted, additionally require `server.businessSelectable === true`.
3. **Adapter** — add `business_selectable boolean not null default false` to
   `admin_mcp_servers`; generate drizzle migration `0028`; map the field in
   `DrizzleMcpServerRepository` (`toEntity`/`create`/`update`) and honour
   `businessSelectableOnly` in `list`.
4. **Wiring** — `mcpServer.register`/`update` accept `businessSelectable`; new
   `mcpServer.listContextForMe` query resolves the caller's `mcp` flag via
   `IsFeatureEnabledForUser` and calls the new use-case with
   `canSelectAll = hasMcpFlag`; `flow.contextMcp.setServers` resolves the same flag
   and passes `restrictToBusinessSelectable = !hasMcpFlag`.
5. **UI** — admin `/admin/mcp-servers`: a "Business-user selectable" control on the
   register form and a toggle per row (accessible — branch enforces WCAG 2.2 AA).
   Flow editor: source the context-MCP picker from `listContextForMe`; render the
   MCP section when the caller has the `mcp` flag **or** the selectable list is
   non-empty, so whitelisted business users get exactly the allowed servers.
6. **e2e + finalise** — Playwright `enhance-mcp-business-selectable.spec.ts`; move
   this doc to `implemented/v1.56.0/`; write summary; bump `VERSION` + `package.json`
   to 1.56.0; `./validate.sh` green; commit; push; open PR.

## Security / governance

- `businessSelectable` defaults to **false** — existing and newly-registered servers
  are admin-only until explicitly opened up.
- The `actions` kind is never business-selectable through this path; write servers
  remain reachable only via the confirmed action node.
- The business-user filter is applied server-side in both the list query and the
  set-servers guard, so the client can never widen its own allow-list.

## Acceptance criteria

- [ ] A newly-registered server has `businessSelectable = false`; the migration
      backfills every existing row to `false` (admin-only until opened up).
- [ ] An admin can set `businessSelectable` on the register form and toggle it per
      row; no read endpoint exposes a credential in doing so.
- [ ] `mcpServer.listContextForMe` returns **all** active `context` servers for a
      caller with the `mcp` flag, and **only** `businessSelectable` active `context`
      servers for a caller without it.
- [ ] A business user attaching a non-whitelisted (or `actions`, or disabled) server
      id to a flow has that id dropped by `SetFlowContextMcpServers` — the flow's
      allow-list never contains it (asserted server-side, not just hidden in the UI).
- [ ] In the flow editor the MCP context section renders for a business user when at
      least one business-selectable `context` server exists, and lists exactly those.
- [ ] `packages/domain` and `packages/application` gain no new dependency; every new
      boundary returns the Result pattern; `validate.sh` passes.
- [ ] `enhance-mcp-business-selectable.spec.ts` covers: admin marks server A
      selectable and leaves B not → business user sees only A and can attach it;
      power user sees both.

## Risks

- **Over-exposure (primary).** A server wrongly marked `businessSelectable` widens
  egress to every business user. Mitigated by default-`false` + admin-only toggle +
  the actions-kind exclusion; the blast radius is read-only context servers.
- **Client-side-only enforcement.** If the filter lived only in the list query, a
  crafted `setServers` call could attach a hidden server. Mitigated by the
  server-side guard in `SetFlowContextMcpServers` being the authoritative boundary.
- **Migration.** Adding a `not null default false` column is additive and backfills
  safely; no data loss, reversible by dropping the column.
- **PRD/ADR drift.** This governance axis post-dates the PRD/ADR-032; they should get
  a one-line note on the business-selectable distinction so docs stay authoritative.

## Out of scope

- Applying the whitelist to Skills (skills stay power-user gated for now).
- Per-flow or per-user grants finer than the global per-server flag.
- Changing the `context`/`actions` model or the human-in-the-loop action node.
