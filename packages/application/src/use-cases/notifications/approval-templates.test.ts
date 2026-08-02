import { describe, expect, it } from "vitest";
import { buildApprovalDecidedEmail, buildApprovalRequestedEmail } from "./approval-templates";

describe("buildApprovalRequestedEmail", () => {
  const requested = (subjectDescription: string | null) =>
    buildApprovalRequestedEmail({
      flowName: "Delegation instrument",
      requesterName: "Olivia Operator",
      instructions: null,
      subjectDescription,
      approvalUrl: "https://wayfinder.test/approvals",
    });

  it("states what the approver is being asked to approve", () => {
    const built = requested('the output of the step "Prepare instrument"');

    expect(built.text).toContain("You are being asked to approve:");
    expect(built.text).toContain("Prepare instrument");
    expect(built.html).toContain("Prepare instrument");
  });

  it("escapes the subject in the HTML body", () => {
    const built = requested('a <script>alert("x")</script> subject');

    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;");
  });

  it("omits the line entirely when no subject resolved", () => {
    const built = requested(null);

    expect(built.text).not.toContain("You are being asked to approve:");
    expect(built.html).not.toContain("You are being asked to approve:");
  });
});

const email = (overrides: Partial<Parameters<typeof buildApprovalDecidedEmail>[0]> = {}) =>
  buildApprovalDecidedEmail({
    flowName: "Delegation instrument",
    status: "approved",
    comment: null,
    sessionUrl: "https://wayfinder.test/chats/sess-1",
    ...overrides,
  });

describe("buildApprovalDecidedEmail", () => {
  it("names a plain approval", () => {
    expect(email().subject).toContain("approved");
    expect(email().subject).not.toContain("with edits");
  });

  it("tells the originator when the approver also edited", () => {
    const built = email({ status: "approved_with_edits" });

    expect(built.subject).toContain("approved with edits");
    expect(built.text).toContain("approved with edits");
  });

  it("calls a rejection that closed the request declined", () => {
    expect(email({ status: "rejected" }).subject).toContain("declined");
  });

  it("calls a rejection that routed the work back a revision, since it is still live", () => {
    expect(email({ status: "rejected", routedBack: true }).subject).toContain(
      "returned for revision",
    );
  });

  it("names a change request as a revision", () => {
    expect(email({ status: "changes_requested" }).subject).toContain("returned for revision");
  });

  it("includes the approver's comment when there is one", () => {
    expect(email({ comment: "Fix the date." }).text).toContain("Fix the date.");
  });
});
