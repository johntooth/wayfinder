import { describe, expect, it } from "vitest";
import {
  buildApprovalDecidedEmail,
  buildApprovalRequestedEmail,
  buildApprovalWithdrawnEmail,
} from "./approval-templates";

describe("buildApprovalRequestedEmail", () => {
  const requested = (subjectDescription: string | null) =>
    buildApprovalRequestedEmail({
      flowName: "Delegation instrument",
      requesterName: "Olivia Operator",
      instructions: null,
      subjectDescription,
      requestMessage: null,
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

  const withMessage = (requestMessage: string | null) =>
    buildApprovalRequestedEmail({
      flowName: "Delegation instrument",
      requesterName: "Olivia Operator",
      instructions: null,
      subjectDescription: null,
      requestMessage,
      approvalUrl: "https://wayfinder.test/approvals",
    });

  it("carries the requester's message, attributed to them", () => {
    const built = withMessage("Board meets Thursday — a signature before then would help.");

    expect(built.text).toContain("Olivia Operator");
    expect(built.text).toContain("Board meets Thursday");
    expect(built.html).toContain("Board meets Thursday");
  });

  it("escapes the requester's message in the HTML body", () => {
    const built = withMessage('<img src=x onerror="alert(1)">');

    expect(built.html).not.toContain("<img");
    expect(built.html).toContain("&lt;img");
  });

  it("omits the message block when the requester wrote nothing", () => {
    const built = withMessage(null);

    expect(built.text).not.toContain("wrote:");
    expect(built.html).not.toContain("wrote:");
  });
});

describe("buildApprovalWithdrawnEmail", () => {
  const withdrawn = (reason: string | null) =>
    buildApprovalWithdrawnEmail({
      flowName: "Delegation instrument",
      requesterName: "Olivia Operator",
      reason,
      approvalUrl: "https://wayfinder.test/approvals",
    });

  it("tells the approver the request was pulled, and by whom", () => {
    const built = withdrawn(null);

    expect(built.subject).toContain("withdrawn");
    expect(built.text).toContain("Olivia Operator");
    expect(built.text).toContain("Delegation instrument");
  });

  // The approver may already be part-way through a review; the reason is the
  // difference between a request vanishing and one being taken back.
  it("carries the reason when the originator gave one", () => {
    const built = withdrawn("The salary figures were stale");

    expect(built.text).toContain("The salary figures were stale");
    expect(built.html).toContain("The salary figures were stale");
  });

  it("escapes the reason in the HTML body", () => {
    const built = withdrawn('<script>alert("x")</script>');

    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;");
  });

  it("omits the reason block when none was given", () => {
    const built = withdrawn(null);

    expect(built.text).not.toContain("Reason:");
    expect(built.html).not.toContain("Reason:");
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
