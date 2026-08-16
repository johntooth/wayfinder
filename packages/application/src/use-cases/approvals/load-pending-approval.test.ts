import { describe, it, expect } from "vitest";
import { LoadPendingApproval } from "./load-pending-approval";
import { SuggestApprover } from "./suggest-approver";
import { InMemoryApprovals, InMemoryUsers, session, user } from "./__fixtures__/approval-doubles";

describe("LoadPendingApproval", () => {
  const users = () => {
    const rows = new InMemoryUsers();
    rows.add(user("grace-1", "grace@corp.test"));
    rows.add(user("manager-1", "rosa@corp.test"));
    return rows;
  };

  it("returns nothing for a node with no pending row, and creates none", async () => {
    const approvals = new InMemoryApprovals();
    const sut = new LoadPendingApproval(approvals, users());

    const result = await sut.execute({ sessionId: "session-1", nodeId: "node-appr" });

    expect(result.error).toBeUndefined();
    expect(result.data).toBeNull();
    // The whole point of splitting this out of SuggestApprover: reading must
    // not write.
    expect(approvals.rows.size).toBe(0);
  });

  // The chained case. The row was confirmed by the *previous approver* from
  // their decision modal, so the originator's gate has to learn the assignment
  // from the row rather than from whatever it saw when it mounted.
  it("names an approver a different user confirmed", async () => {
    const approvals = new InMemoryApprovals();
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "approver-a",
      approverSource: "first_level_supervisor",
      suggestedApproverUserId: "manager-1",
      approverUserId: "grace-1",
    });
    const sut = new LoadPendingApproval(approvals, users());

    const result = await sut.execute({ sessionId: "session-1", nodeId: "node-appr" });

    expect(result.data?.approval.id).toBe(created.data!.id);
    expect(result.data?.assignedApprover).toMatchObject({
      userId: "grace-1",
      email: "grace@corp.test",
    });
    // The suggestion is still reported, and is deliberately not the assignee.
    expect(result.data?.suggestedApprover?.userId).toBe("manager-1");
  });

  it("reports an email-only assignment, which has no account behind it", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverEmail: "external@partner.test",
    });
    const sut = new LoadPendingApproval(approvals, users());

    const result = await sut.execute({ sessionId: "session-1", nodeId: "node-appr" });

    expect(result.data?.assignedApprover).toEqual({
      userId: null,
      name: null,
      email: "external@partner.test",
    });
  });

  it("reports no assignee for a row nobody has confirmed yet", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      suggestedApproverUserId: "manager-1",
    });
    const sut = new LoadPendingApproval(approvals, users());

    const result = await sut.execute({ sessionId: "session-1", nodeId: "node-appr" });

    expect(result.data?.assignedApprover).toBeNull();
    expect(result.data?.suggestedApprover?.userId).toBe("manager-1");
  });

  // A decided row is not what gates the node, so it must not be served as one.
  it("ignores a row that has already been decided", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "grace-1",
      status: "approved",
    });
    const sut = new LoadPendingApproval(approvals, users());

    const result = await sut.execute({ sessionId: "session-1", nodeId: "node-appr" });

    expect(result.data).toBeNull();
  });
});
