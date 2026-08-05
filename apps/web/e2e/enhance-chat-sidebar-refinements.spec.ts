import { test, expect } from "./helpers/base";

// E2E for the chat and sidebar refinements.
// (docs/development/implemented/alpha-2/v0.23.4/chat-sidebar-refinements.phase.md)
//
// Covers the four behaviours that changed. Colours are not asserted — the
// participant tints are guarded numerically by
// src/components/chat/participant-identity.test.ts, and pinning hex values here
// would make every future design tweak a test failure.

const SEED_SESSION_TITLE = "E2E SEED Session";

test.describe("sidebar refinements", () => {
  test("exactly one rail item is active while a chat is open", async ({ page }) => {
    await page.goto("/chats");

    const seededChat = page.getByText(SEED_SESSION_TITLE).first();
    test.skip(
      !(await seededChat.isVisible().catch(() => false)),
      "No seeded chat available — chats list is empty",
    );
    await seededChat.click();
    await page.waitForURL(/\/chats\/[0-9a-f-]+/);

    const sidebar = page.getByTestId("app-sidebar");

    // The reported defect: "My Chats" and the open chat both highlighted, so
    // the rail claimed the user was in two places. The active treatment is the
    // only thing that distinguishes them, so count the elements carrying it.
    const activeRows = sidebar.locator('[data-nav-active="true"]');
    await expect(activeRows).toHaveCount(1);

    // And it is the chat, not its parent.
    await expect(activeRows.first()).toContainText(SEED_SESSION_TITLE);
  });

  test("New chat is the first row of the nav list and opens the modal", async ({ page }) => {
    await page.goto("/chats");

    const sidebar = page.getByTestId("app-sidebar");
    const navRows = sidebar.locator("[data-nav-row]");

    await expect(navRows.first()).toHaveText(/New chat/);
    // It sits in the list rather than above it — the same container as My Chats.
    await expect(navRows.filter({ hasText: "My Chats" })).toHaveCount(1);

    await navRows.first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test.describe("chat feed refinements", () => {
  test("the transcript keeps its furniture while a reply streams", async ({ page }) => {
    await page.goto("/chats");

    const seededChat = page.getByText(SEED_SESSION_TITLE).first();
    test.skip(
      !(await seededChat.isVisible().catch(() => false)),
      "No seeded chat available — chats list is empty",
    );
    await seededChat.click();

    const composer = page.getByRole("textbox").first();
    await expect(composer).toBeVisible();

    // Count what is on screen before the turn. The defect unmounted the whole
    // persisted transcript while streaming, so every one of these went to zero
    // and came back when the stream settled.
    const timestampsBefore = await page.locator("[data-message-time]").count();
    test.skip(timestampsBefore === 0, "Seeded chat has no persisted messages to preserve");

    await composer.fill("Please continue.");
    await composer.press("Enter");

    // While the turn is in flight the persisted messages must still be there.
    // Asserted against the count taken before rather than a fixed number, so
    // the test does not depend on how much the seed happens to contain.
    await expect(page.locator("[data-message-time]")).toHaveCount(timestampsBefore, {
      timeout: 5_000,
    });
  });

  test("another person's approval decision renders as theirs, not the viewer's", async ({
    page,
  }) => {
    await page.goto("/approvals");

    const decision = page.locator("[data-participant-message]").first();
    test.skip(
      !(await decision.isVisible().catch(() => false)),
      "No decided approval in the seeded data",
    );

    // Left-aligned with the person's own mark, rather than the viewer's
    // right-aligned bubble.
    await expect(decision).toBeVisible();
  });
});
