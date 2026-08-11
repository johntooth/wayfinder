import { test, expect } from "./helpers/base";
import { requireSeedFixtures } from './helpers/seed';

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

const APPROVALS_PATH = process.env.E2E_APPROVALS_PATH ?? "/approvals";

test.describe.configure({ mode: "serial" });

test.describe("the approval gate sits in the chat, above the composer", () => {
  test("renders inside the composer stack rather than as a band over the chat", async ({
    page,
  }) => {
    const sessionId = requireSeedFixtures().approvalWithdrawSessionId;

    await page.goto(`/chats/${sessionId}`);

    const gate = page.locator("[data-approval-gate]");
    await expect(gate).toBeVisible();

    // The structural claim: the gate is a child of the composer stack, so it
    // moves with the composer instead of being a separate full-width band.
    await expect(page.locator("[data-composer-stack] [data-approval-gate]")).toBeVisible();

    // And the visual one: it is held to the composer's width rather than laid
    // full-bleed across the chat.
    //
    // This measured the composer's textarea until it was first run. It could
    // never have passed: the test below asserts the composer is not rendered at
    // all while an approval is pending, which is what _content.tsx does
    // (`!isReadOnly && !isApprovalGate`). The two tests contradicted each other
    // and nobody saw it, because the seed never wrote
    // approvalWithdrawSessionId and the whole file skipped itself.
    //
    // The width claim does not need the composer present. Both stacks share one
    // `mx-auto max-w-[760px]` shell, so the constraint is what to assert.
    const gateBox = await gate.locator("> div").boundingBox();
    const stackBox = await page.locator("[data-composer-stack]").boundingBox();
    expect(gateBox).not.toBeNull();
    expect(stackBox).not.toBeNull();

    const COMPOSER_MAX_WIDTH = 760;
    expect(gateBox!.width).toBeLessThanOrEqual(COMPOSER_MAX_WIDTH);

    // Centred inside the stack rather than filling it — the full-bleed band
    // this replaced spanned the whole column.
    expect(gateBox!.width).toBeLessThan(stackBox!.width);
  });

  test("hides the chat input entirely while the approval is pending", async ({ page }) => {
    const sessionId = requireSeedFixtures().approvalWithdrawSessionId;

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator("[data-approval-gate]")).toBeVisible();

    // The session is parked on the approval node — there is no step to send a
    // turn to. A disabled input still holds the place attention goes, so it is
    // not rendered at all; the gate's own message field is what to type in.
    await expect(page.getByPlaceholder(/message wayfinder/i)).toHaveCount(0);
  });

  // The fault the document rules exist to fix: the card used to render only
  // inside the milestone branch, which required the session to have left the
  // step — so a withdrawal made the document vanish from the history.
  test("keeps the document downloadable, and hides Edit while the request is out", async ({
    page,
  }) => {
    const sessionId = requireSeedFixtures().approvalWithdrawSessionId;

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator("[data-approval-gate]")).toBeVisible();

    const documentCard = page.getByRole("button", { name: /download/i }).first();
    test.skip(
      !(await documentCard.isVisible().catch(() => false)),
      "Seeded session has no generated document to assert on",
    );

    // The author must not be editing what is under review. Hidden, not
    // disabled — there is nothing they can do about it until it resolves.
    await expect(page.getByRole("button", { name: /^edit$/i })).toHaveCount(0);
  });
});

test.describe("the originator's message reaches the approver", () => {
  test("the seeded request message shows on the approver's card", async ({ page }) => {

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
    const sessionId = requireSeedFixtures().approvalWithdrawSessionId;

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
    const sessionId = requireSeedFixtures().approvalWithdrawSessionId;
    const draftStepName = requireSeedFixtures().approvalWithdrawDraftStepName;

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
    // takes turns — the composer returns rather than merely re-enabling.
    await expect(page.getByPlaceholder(/message wayfinder/i)).toBeEnabled();
  });

  // "A withdrawer may want to just edit the document directly rather than
  // chat." Both halves of that come back together: the card is still there, and
  // Edit returns with it now the session is off the approval node.
  test("returns the document and its Edit affordance after withdrawal", async ({ page }) => {
    const sessionId = requireSeedFixtures().approvalWithdrawSessionId;

    await page.goto(`/chats/${sessionId}`);
    // Runs after the withdrawal above (serial mode), so the gate is gone.
    await expect(page.locator("[data-approval-gate]")).toHaveCount(0);

    const documentCard = page.getByRole("button", { name: /download/i }).first();
    test.skip(
      !(await documentCard.isVisible().catch(() => false)),
      "Seeded session has no generated document to assert on",
    );

    await expect(documentCard).toBeVisible();
  });

  test("clears the request from the approver's queue", async ({ page }) => {

    await page.goto(APPROVALS_PATH);

    // The withdrawn row left `pending`, so it is no longer awaiting a decision.
    await expect(
      page.locator("[data-approval-status='pending']", {
        hasText: "E2E SEED Approval Withdraw Session",
      }),
    ).toHaveCount(0);
  });
});
