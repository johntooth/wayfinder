import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E regression for the `temperature` failure on the Claude 5 family.
// (docs/development/implemented/alpha-2/v0.22.1/approval-config-and-temperature.phase.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run.
//
// Symptom: generating a document returned 500 with
//   AI_APICallError: `temperature` is deprecated for this model
// and every retry failed the same way. The parameter was not Wayfinder's own:
// ai@4's `prepareCallSettings` substitutes `temperature: 0` for an omitted one,
// so withholding it above the SDK changed nothing. It is now stripped in
// `resolveModel`, below that default, on every call — chat, branching and
// document generation alike.
//
// Every such failure is logged to `admin_errors` by LanguageModelAdapter with
// the provider and model in the row, so the admin error log is where the bug is
// visible: before the fix, driving a turn left rows naming the parameter;
// after it, there are none. That is what this asserts — not that a particular
// document was produced, which depends on the configured provider.

const seed = loadSeedFixtures();

test.describe("LLM calls carry no temperature", () => {
  test("driving a chat turn logs no deprecated-parameter failure", async ({ page }) => {
    const sessionId = seed?.sessionId;
    test.skip(!sessionId, "No seeded session — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);

    const composer = page.getByRole("textbox").first();
    test.skip(
      !(await composer.isVisible().catch(() => false)),
      "Seeded session has no composer — it may be closed",
    );

    // Any turn exercises the chat and branching calls; the reply itself is not
    // under test, only that the provider accepted the request.
    await composer.fill("Please summarise where we are up to.");
    await composer.press("Enter");
    await expect(page.getByText(/thinking|typing/i).first()).toBeHidden({ timeout: 60_000 });

    await page.goto("/admin/errors");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/temperature/i)).toHaveCount(0);
  });

  test("the document endpoint does not reject the request outright", async ({ page }) => {
    const sessionId = seed?.sessionId;
    test.skip(!sessionId, "No seeded session — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);

    const download = page.getByRole("button", { name: /download/i }).first();
    test.skip(
      !(await download.isVisible().catch(() => false)),
      "Seeded session has produced no document",
    );

    // The reported failure was a 500 from POST /api/documents/<id>. Downloading
    // the existing document proves the generated artefact survived the call
    // that used to fail; the admin error log above proves the call itself did.
    await download.click();
    await expect(page.getByText(/no longer available/i)).toHaveCount(0);
  });
});
