import { describe, it, expect } from "vitest";
import { ListApprovals } from "./list-approvals";
import { InMemoryApprovals, session } from "./__fixtures__/approval-doubles";

describe("ListApprovals", () => {
  it("returns only the pending approvals for the given approver", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    const other = await approvals.create({
      sessionId: "session-2",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-2",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-2",
    });
    await approvals.update(other.data!.id, { status: "approved" });
    const sut = new ListApprovals(approvals);

    const result = await sut.execute({
      approverUserId: "manager-1",
      approverEmail: null,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.approverUserId).toBe("manager-1");
  });

  it("matches approvals routed only by email so the recipient can claim them", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverEmail: "manager@corp.test",
    });
    const sut = new ListApprovals(approvals);

    const result = await sut.execute({
      approverUserId: "manager-1",
      approverEmail: "manager@corp.test",
    });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.approverEmail).toBe("manager@corp.test");
  });

  // Regression guard: the originator discarded the chat, but the approval it
  // raised stayed in the approver's queue awaiting a decision that could no
  // longer do anything.
  it("hides an approval whose session was discarded", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    approvals.sessionStatuses.set("session-1", "abandoned");
    const sut = new ListApprovals(approvals);

    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data).toEqual([]);
  });

  it("hides an approval whose session a rejection cancelled", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    approvals.sessionStatuses.set("session-1", "cancelled");
    const sut = new ListApprovals(approvals);

    expect((await sut.execute({ approverUserId: "manager-1", approverEmail: null })).data).toEqual(
      [],
    );
  });

  it("keeps an approval on a completed session", async () => {
    // `complete` is not `discarded`: the approvals are what completed it.
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    approvals.sessionStatuses.set("session-1", "complete");
    const sut = new ListApprovals(approvals);

    expect((await sut.execute({ approverUserId: "manager-1", approverEmail: null })).data).toHaveLength(
      1,
    );
  });
});
