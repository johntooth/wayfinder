import { expect, test } from "@playwright/test";

// E2E for the MCP business-selectable whitelist (enhancement on Phase 2 of the
// Flow Skills & MCP PRD, ADR-032).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Assumes an authenticated admin storageState.
//
// This spec covers the admin governance surface: marking a context server
// business-selectable at registration, the Selectable column reflecting state,
// toggling it, and actions servers being excluded. The downstream effect — a
// business user seeing only whitelisted servers in the flow picker — is enforced
// server-side and covered authoritatively by unit tests
// (ListSelectableContextMcpServers and the SetFlowContextMcpServers guard), since
// the e2e harness carries a single admin role.

test.describe("mcp business-selectable whitelist", () => {
  test("an admin registers a business-selectable context server and it is marked selectable", async ({
    page,
  }) => {
    await page.goto("/admin/mcp-servers");

    await page.getByLabel("Label").fill("E2E Spellcheck");
    await page.getByLabel("SSE URL").fill("https://mcp.example.com/spell/sse");
    await page.getByLabel(/business-user selectable/i).check();
    await page.getByRole("button", { name: /register server/i }).click();

    const row = page.getByRole("row", { name: /E2E Spellcheck/i }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: /disable business-user selection/i })).toBeVisible();
  });

  test("an admin registers an admin-only context server, then opens it up", async ({ page }) => {
    await page.goto("/admin/mcp-servers");

    await page.getByLabel("Label").fill("E2E Database");
    await page.getByLabel("SSE URL").fill("https://mcp.example.com/db/sse");
    // Leave the business-selectable box unchecked — admin-only by default.
    await page.getByRole("button", { name: /register server/i }).click();

    const row = page.getByRole("row", { name: /E2E Database/i }).first();
    const toggle = row.getByRole("button", { name: /business-user selection for E2E Database/i });
    await expect(toggle).toHaveText(/admin only/i);

    await toggle.click();
    await expect(
      row.getByRole("button", { name: /disable business-user selection for E2E Database/i }),
    ).toHaveText(/business/i);
  });

  test("an actions server cannot be made business-selectable", async ({ page }) => {
    await page.goto("/admin/mcp-servers");

    await page.getByLabel("Label").fill("E2E Actions");
    await page.getByLabel("SSE URL").fill("https://mcp.example.com/act/sse");
    await page.getByLabel("Type").selectOption("actions");
    // The business-selectable checkbox is hidden for actions servers.
    await expect(page.getByLabel(/business-user selectable/i)).toHaveCount(0);
    await page.getByRole("button", { name: /register server/i }).click();

    const row = page.getByRole("row", { name: /E2E Actions/i }).first();
    await expect(row).toBeVisible();
    // No selectable toggle is offered for an actions server.
    await expect(row.getByRole("button", { name: /business-user selection/i })).toHaveCount(0);
  });
});
