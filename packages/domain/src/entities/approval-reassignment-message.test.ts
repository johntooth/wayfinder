import { describe, expect, it } from "vitest";
import { buildApprovalReassignmentMessage } from "./approval-reassignment-message";

const reassignedAt = new Date("2026-08-07T11:05:00.000Z");

const base = {
  actorName: "Dana Whitlock",
  actorEmail: "dana.whitlock@example.com",
  previousApproverName: "Rosa Okafor",
  previousApproverEmail: "rosa.okafor@example.com",
  newApproverName: "Sam Patel",
  newApproverEmail: "sam.patel@example.com",
  reassignedAt,
};

describe("buildApprovalReassignmentMessage", () => {
  it("names who moved it, off whom, and onto whom", () => {
    const content = buildApprovalReassignmentMessage(base);

    expect(content).toContain("Dana Whitlock");
    expect(content).toContain("Rosa Okafor");
    expect(content).toContain("Sam Patel");
    expect(content).toContain(reassignedAt.toISOString());
  });

  // The author watching the chat needs "who is this with now" answerable at a
  // glance; the new approver is the point of the message.
  it("leads with the new approver", () => {
    const content = buildApprovalReassignmentMessage(base);
    const firstLine = content.split("\n")[0] ?? "";

    expect(firstLine).toContain("Sam Patel");
  });

  // A first approval reassigned before anyone was ever confirmed has no
  // previous approver to name.
  it("reads correctly when there was no previous approver", () => {
    const content = buildApprovalReassignmentMessage({
      ...base,
      previousApproverName: null,
      previousApproverEmail: null,
    });

    expect(content).toContain("Sam Patel");
    expect(content).not.toContain("null");
    expect(content).not.toContain("from ()");
  });

  // Identity is copied in rather than joined at read time (ADR-040 §5), so a
  // deleted or half-populated account yields nulls.
  it("falls back to the email when a party has no name", () => {
    const content = buildApprovalReassignmentMessage({
      ...base,
      actorName: null,
      newApproverName: null,
    });

    expect(content).toContain("dana.whitlock@example.com");
    expect(content).toContain("sam.patel@example.com");
    expect(content).not.toContain("null");
  });

  it("omits an identity clause entirely when neither name nor email is known", () => {
    const content = buildApprovalReassignmentMessage({
      ...base,
      actorName: null,
      actorEmail: null,
    });

    expect(content).toContain("Sam Patel");
    expect(content).not.toContain("null");
    expect(content).not.toContain("()");
  });
});
