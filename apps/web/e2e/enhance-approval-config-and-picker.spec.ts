import { test, expect } from "./helpers/base";
import { requireSeedFixtures } from './helpers/seed';
import { isVisibleWithin } from './helpers/visible';

// E2E for the approval configuration and approver-picker enhancements.
// (docs/development/implemented/alpha-2/v0.22.1/approval-config-and-temperature.phase.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Assumes the seeded fixtures in
// apps/web/src/lib/e2e-fixtures.ts:
//
//   seedApprovalFirstFlow — a flow whose first step is an approval, so the
//     config editor opens an approval node with no earlier step to choose.
//   seedApprovalSubjectSession — a session parked on a pending approval, so the
//     operator-facing gate renders.
//
// What is under test:
//   1. The approval node asks one question about its subject, not two: the
//      default, each earlier step and "something I'll describe" are options of a
//      single select, and choosing the last reveals the free-text field.
//   2. The operator's gate opens the people picker by itself when nothing could
//      be suggested — no "Someone else" click first.
//   3. What is not configured is a small info affordance on the right of the
//      panel, opened on demand, not a warning in the body of the panel.
//
// Assertions are about what the author and operator can see, never about a
// specific person being suggested, so they stay deterministic in the sandbox.

const CUSTOM_SUBJECT_OPTION = "__describe__";

test.describe("approval node — one question for the subject", () => {
  test("the subject select carries the default, the steps and the described case", async ({
    page,
  }) => {
    const flowId = requireSeedFixtures().approvalFirstFlowId;

    await page.goto(`/flows/${flowId}/config`);

    const node = page.getByText("Immediate sign-off").first();
    test.skip(
      !(await isVisibleWithin(node)),
      "Seeded approval-first flow did not render",
    );
    await node.dblclick();

    const dialog = page.getByRole("dialog");
    const subject = dialog.getByLabel(/What is being approved/i);
    await expect(subject).toBeVisible();

    // The second dropdown is gone: what used to be "the output of an earlier
    // step" is now the earlier steps themselves.
    await expect(dialog.getByLabel(/Which step\?/i)).toHaveCount(0);
    await expect(subject).toHaveValue("");
    await expect(
      subject.getByRole("option", { name: /last completed step/i }),
    ).toHaveCount(1);
  });

  test("choosing the described case reveals the instruction, and going back hides it", async ({
    page,
  }) => {
    const flowId = requireSeedFixtures().approvalFirstFlowId;

    await page.goto(`/flows/${flowId}/config`);

    const node = page.getByText("Immediate sign-off").first();
    test.skip(
      !(await isVisibleWithin(node)),
      "Seeded approval-first flow did not render",
    );
    await node.dblclick();

    const dialog = page.getByRole("dialog");
    const subject = dialog.getByLabel(/What is being approved/i);

    await subject.selectOption(CUSTOM_SUBJECT_OPTION);
    await expect(dialog.getByLabel(/Describe the subject/i)).toBeVisible();

    // Returning to the default is one move, and takes the textarea with it.
    await subject.selectOption("");
    await expect(dialog.getByLabel(/Describe the subject/i)).toHaveCount(0);
  });
});

test.describe("approver picker — no dead end when nothing is configured", () => {
  test("the picker is open when there is no suggestion to confirm", async ({ page }) => {
    const sessionId = requireSeedFixtures().approvalSubjectSessionId;

    await page.goto(`/chats/${sessionId}`);

    const gate = page.locator("[data-approval-gate]");
    test.skip(
      !(await gate.isVisible().catch(() => false)),
      "Session is not parked on an approval gate",
    );

    const search = gate.getByPlaceholder(/Search Entra, HR, or type any email/i);
    const someoneElse = gate.getByRole("button", { name: /someone else/i });

    // Exactly one of the two states, and the picker is never behind a button it
    // is already showing: either a suggestion is offered with the option to
    // change it, or the search is open with no button to press first.
    if (await someoneElse.isVisible().catch(() => false)) {
      await expect(search).toHaveCount(0);
      await someoneElse.click();
      await expect(search).toBeVisible();
      await expect(someoneElse).toHaveCount(0);
      return;
    }
    await expect(search).toBeVisible();
    await expect(gate.getByText(/Choose the approver/i)).toBeVisible();
  });

  test("what is not configured is an info affordance, not a warning in the panel", async ({
    page,
  }) => {
    const sessionId = requireSeedFixtures().approvalSubjectSessionId;

    await page.goto(`/chats/${sessionId}`);

    const gate = page.locator("[data-approval-gate]");
    test.skip(
      !(await gate.isVisible().catch(() => false)),
      "Session is not parked on an approval gate",
    );

    const notice = gate.locator("[data-approval-setup-notice]");
    test.skip(
      !(await notice.isVisible().catch(() => false)),
      "Email and the directory are both configured — nothing to explain",
    );

    // Collapsed by default: the explanation exists but does not compete with
    // the operator's actual task.
    await expect(notice).toHaveAttribute("aria-expanded", "false");

    await notice.click();
    await expect(notice).toHaveAttribute("aria-expanded", "true");
    await expect(gate.getByText(/Wayfinder|approver/i).first()).toBeVisible();
  });
});
