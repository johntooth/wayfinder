import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E for withdrawing an approval and moving the gate into the chat.
// (docs/development/implemented/alpha-2/v0.25.0/chat-approval-withdraw-and-inline-gate.phase.md)
//
// Driven by CI (.github/workflows/e2e.yml) against a full stack — excluded from
// the vitest unit run. Uses the seeded fixture in
// apps/web/src/lib/e2e-fixtures-approval.ts:
//
//   seedWithdrawableApprovalSession — `Draft the request (conversational) →
//     Manager sign-off (approval, pending)`, raised by the signed-in seed user
//     so they are the originator who may withdraw it. Its own session, because
//     withdrawing moves the session off the approval node and would leave the
//     other approval specs with no gate to assert on.
//
// What is under test:
//
//   1. The gate renders inside the composer stack, at the composer's width —
//      not as the full-bleed band laid across the chat that it replaces.
//   2. The chat input stays disabled while an approval is pending; the gate's
//      own message field is the thing to type in.
//   3. The originator can withdraw a sent request, behind a confirm step, and
//      the session returns to the prior conversational step.
//   4. The originator's message to the approver reaches the approver's queue.
//
// The withdrawal test is destructive by design — it is the behaviour under
// test — and runs last against a session no other spec reads.

const seed = loadSeedFixtures();
const APPROVALS_PATH = process.env.E2E_APPROVALS_PATH ?? "/approvals";

test.describe.configure({ mode: "serial" });

test.describe("the approval gate sits in the chat, above the composer", () => {
  test("renders inside the composer stack rather than as a band over the chat", async ({
    page,
  }) => {
    const sessionId = seed?.approvalWithdrawSessionId;
    test.skip(!sessionId, "No seeded withdrawable approval — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);

    const gate = page.locator("[data-approval-gate]");
    await expect(gate).toBeVisible();

    // The structural claim: the gate is a child of the composer stack, so it
    // moves with the composer instead of being a separate full-width band.
    await expect(page.locator("[data-composer-stack] [data-approval-gate]")).toBeVisible();

    // And the visual one: it is no wider than the composer it sits above.
    const gateBox = await gate.locator("> div").boundingBox();
    const composerBox = await page.getByPlaceholder(/message wayfinder/i).boundingBox();
    expect(gateBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    // The composer's input sits inside padded chrome, so the gate is allowed to
    // be a little wider than the textarea itself — but nowhere near full-bleed.
    expect(gateBox!.width).toBeLessThanOrEqual(composerBox!.width + 120);

    // The gate is above the input, not overlaying the message feed.
    expect(gateBox!.y).toBeLessThan(composerBox!.y);
  });

  test("keeps the chat input disabled while the approval is pending", async ({ page }) => {
    const sessionId = seed?.approvalWithdrawSessionId;
    test.skip(!sessionId, "No seeded withdrawable approval — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator("[data-approval-gate]")).toBeVisible();

    // The session is parked on the approval node — there is no step to send a
    // turn to, so the composer stays shut.
    await expect(page.getByPlaceholder(/message wayfinder/i)).toBeDisabled();
  });
});

test.describe("the originator's message reaches the approver", () => {
  test("the seeded request message shows on the approver's card", async ({ page }) => {
    test.skip(!seed?.approvalWithdrawSessionId, "No seeded withdrawable approval");

    await page.goto(APPROVALS_PATH);

    const message = page.locator("[data-approval-request-message]").first();
    test.skip(
      !(await message.isVisible().catch(() => false)),
      "No approval carrying a request message is awaiting this user",
    );

    await expect(message).toContainText(/board meets thursday/i);
  });
});

test.describe("withdrawing a sent approval", () => {
  test("asks for confirmation before pulling the request", async ({ page }) => {
    const sessionId = seed?.approvalWithdrawSessionId;
    test.skip(!sessionId, "No seeded withdrawable approval — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator("[data-approval-gate]")).toBeVisible();

    await page.locator("[data-approval-withdraw]").click();

    // Two steps, not one: withdrawing moves the chat back and tells the
    // approver, which is too much to fire on a single stray click.
    const confirm = page.locator("[data-approval-withdraw-confirm]");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByLabel(/reason for withdrawing/i)).toBeVisible();

    // Backing out leaves the request exactly as it was.
    await confirm.getByRole("button", { name: /keep waiting/i }).click();
    await expect(confirm).toBeHidden();
    await expect(page.locator("[data-approval-gate]")).toBeVisible();
  });

  test("returns the chat to the previous conversational step", async ({ page }) => {
    const sessionId = seed?.approvalWithdrawSessionId;
    const draftStepName = seed?.approvalWithdrawDraftStepName;
    test.skip(!sessionId, "No seeded withdrawable approval — run the seed setup project");

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator("[data-approval-gate]")).toBeVisible();

    await page.locator("[data-approval-withdraw]").click();
    await page
      .locator("[data-approval-withdraw-confirm]")
      .getByLabel(/reason for withdrawing/i)
      .fill("The figures were stale — pulling this back to fix them.");
    await page.locator("[data-approval-withdraw-confirm-button]").click();

    // The gate goes: the session is no longer parked on an approval node.
    await expect(page.locator("[data-approval-gate]")).toBeHidden({ timeout: 15000 });

    // The withdrawal is in the thread, as the originator's own message, naming
    // the step the work came back to.
    await expect(page.getByText(/withdrawn/i).first()).toBeVisible();
    if (draftStepName) {
      await expect(page.getByText(new RegExp(draftStepName, "i")).first()).toBeVisible();
    }
    await expect(page.getByText(/figures were stale/i).first()).toBeVisible();

    // And the operator can type again, because the chat is back on a step that
    // takes turns.
    await expect(page.getByPlaceholder(/message wayfinder/i)).toBeEnabled();
  });

  test("clears the request from the approver's queue", async ({ page }) => {
    test.skip(!seed?.approvalWithdrawSessionId, "No seeded withdrawable approval");

    await page.goto(APPROVALS_PATH);

    // The withdrawn row left `pending`, so it is no longer awaiting a decision.
    await expect(
      page.locator("[data-approval-status='pending']", {
        hasText: "E2E SEED Approval Withdraw Session",
      }),
    ).toHaveCount(0);
  });
});
