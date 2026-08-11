import { test, expect } from "./helpers/base";
import { clearAiScript, completeTurn, incompleteTurn, scriptAiFor } from "./helpers/ai-script";
import { requireSeedFixtures } from "./helpers/seed";

// E2E for bug #1: a node whose advanceConfidenceThreshold was authored as a
// fraction (0.7) instead of a percentage (70) must NOT auto-advance on its own
// opening message before the user has answered anything.
// (docs/development/implemented/alpha-1/v1.49.0/fix-flow-authored-data-trust.md)
//
// On the unfixed code, `5 >= 0.7` was always true, so every step advanced on its
// low-confidence opener and the chat raced to completion without input. With
// normalise-on-read (0.7 -> 70) the opener stays on its step.
//
// This was parked behind E2E_SESSION_PATH for years because the confidence it
// turns on is produced by the *server*: the mock in helpers/base.ts is a
// page.route intercept and never sees that call. It now scripts the server-side
// model directly (helpers/ai-script.ts), so the confidence under test is chosen
// by the test rather than by whatever the provider happened to say.

test.describe("confidence is read on the 0-100 scale, not as a fraction", () => {
  test.afterEach(async ({ page }) => {
    await clearAiScript(page, requireSeedFixtures().sessionId);
  });

  test("a low-confidence turn stays on its step instead of racing ahead", async ({ page }) => {
    const { sessionId } = requireSeedFixtures();
    await scriptAiFor(page, sessionId, [
      incompleteTurn("Before I can draft this, what is the budget envelope?", 20),
    ]);

    await page.goto(`/chats/${sessionId}`);
    const composer = page.getByPlaceholder(/message wayfinder/i);
    await expect(composer).toBeVisible({ timeout: 30_000 });

    await composer.fill("Let's get started.");
    await composer.press("Enter");

    // The scripted reply is the server's, so seeing it proves the stub drove the
    // turn rather than the browser-level mock answering for it.
    await expect(page.getByText(/what is the budget envelope/i)).toBeVisible({ timeout: 30_000 });

    // 20 is below every sane threshold. Read as the fraction 0.20 it would still
    // have cleared 0.7 under the bug, and the session would have run on.
    await expect(page.getByText(/low confidence/i).last()).toBeVisible();
    await expect(page.getByText(/session complete|workflow complete/i)).toHaveCount(0);
  });

  test("a high-confidence turn is reported as such", async ({ page }) => {
    const { sessionId } = requireSeedFixtures();
    await scriptAiFor(page, sessionId, [
      completeTurn("That covers everything this step needs.", 95),
    ]);

    await page.goto(`/chats/${sessionId}`);
    const composer = page.getByPlaceholder(/message wayfinder/i);
    await expect(composer).toBeVisible({ timeout: 30_000 });

    await composer.fill("The budget is £40,000 and the deadline is March.");
    await composer.press("Enter");

    await expect(page.getByText(/that covers everything this step needs/i)).toBeVisible({
      timeout: 30_000,
    });
    // The pair is the point: the same code path reports 20 as low and 95 as
    // high, so the scale is being read as a percentage at both ends.
    await expect(page.getByText(/high confidence/i).last()).toBeVisible();
  });
});
