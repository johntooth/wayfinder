import { describe, it, expect } from "vitest";
import { ConfirmAndSend } from "./confirm-and-send";
import { InMemoryApprovals, RecordingAuditLogger, session } from "./__fixtures__/approval-doubles";

describe("ConfirmAndSend", () => {
  const seedPending = async (approvals: InMemoryApprovals) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      suggestedApproverUserId: "manager-1",
    });
    return created.data!;
  };

  it("persists a confirmed approver and audits the request", async () => {
    const approvals = new InMemoryApprovals();
    const audit = new RecordingAuditLogger();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, audit);

    const result = await sut.execute({
      approvalId: approval.id,
      approverUserId: "manager-1",
      isOverride: false,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.approverUserId).toBe("manager-1");
    expect(audit.entries.map((entry) => entry.action)).toContain("approval.requested");
  });

  it("accepts a free-typed email and records the override flag", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({
      approvalId: approval.id,
      approverEmail: "someone@external.test",
      isOverride: true,
    });

    expect(result.data?.approverEmail).toBe("someone@external.test");
    expect(result.data?.isOverride).toBe(true);
  });

  it("rejects sending with no approver chosen", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({ approvalId: approval.id, isOverride: false });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("persists the originator's message to the approver", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({
      approvalId: approval.id,
      approverUserId: "manager-1",
      isOverride: false,
      requestMessage: "Numbers are from the June forecast — signing before Friday would help.",
    });

    expect(result.data?.requestMessage).toContain("June forecast");
  });

  // Blank is not a message. Storing "" would put an empty block in the email
  // and an empty panel in the approver's view.
  it("stores a blank message as null", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({
      approvalId: approval.id,
      approverUserId: "manager-1",
      isOverride: false,
      requestMessage: "   ",
    });

    expect(result.data?.requestMessage).toBeNull();
  });

  it("leaves the message null when none was written", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({
      approvalId: approval.id,
      approverUserId: "manager-1",
      isOverride: false,
    });

    expect(result.data?.requestMessage).toBeNull();
  });
});
