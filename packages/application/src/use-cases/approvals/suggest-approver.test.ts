import { describe, it, expect } from "vitest";
import {
  type Person,
} from "@rbrasier/domain";
import { SuggestApprover } from "./suggest-approver";
import { InMemoryApprovals, InMemoryFlowNodes, InMemoryUsers, StubDocumentChunks, StubEmbeddings, StubLanguageModel, StubResolver, approvalNode, policyChunk, session, user } from "./__fixtures__/approval-doubles";

describe("SuggestApprover", () => {
  it("suggests the first-level supervisor from the resolver and writes a pending row", async () => {
    const approvals = new InMemoryApprovals();
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode());
    const users = new InMemoryUsers();
    users.add(user("manager-1", "manager@corp.test"));
    const resolver = new StubResolver({ suggestedApproverUserId: "manager-1" });
    const sut = new SuggestApprover(approvals, nodes, resolver, users);

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.approval.status).toBe("pending");
    expect(result.data?.approval.suggestedApproverUserId).toBe("manager-1");
    expect(result.data?.suggestedApprover?.email).toBe("manager@corp.test");
  });

  it("is idempotent — reaching the node twice returns the same pending row", async () => {
    const approvals = new InMemoryApprovals();
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode());
    const sut = new SuggestApprover(
      approvals,
      nodes,
      new StubResolver({ unresolved: true }),
      new InMemoryUsers(),
    );
    const input = {
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    };

    const first = await sut.execute(input);
    const second = await sut.execute(input);

    expect(first.data?.approval.id).toBe(second.data?.approval.id);
    expect(approvals.rows.size).toBe(1);
  });

  it("leaves the suggestion empty when the chain is unresolved", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode());
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      new StubResolver({ unresolved: true }),
      new InMemoryUsers(),
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.data?.approval.suggestedApproverUserId).toBeNull();
    expect(result.data?.suggestedApprover).toBeNull();
  });

  it("for dynamic, suggests the single unambiguous position holder", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "SES Band 1" } }));
    const users = new InMemoryUsers();
    users.add(user("delegate-1", "delegate@corp.test"));
    const holder: Person = {
      source: "entra",
      directoryId: "d1",
      userId: "delegate-1",
      displayName: "Del Egate",
      email: "delegate@corp.test",
      jobTitle: "SES Band 1",
      department: "Policy",
    };
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      new StubResolver({ unresolved: true }, [holder]),
      users,
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.data?.approval.suggestedApproverUserId).toBe("delegate-1");
  });

  it("dynamic: uses the RAG-extracted role to call findPositionHolder when chunks are found", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "the delegate" } }));
    const users = new InMemoryUsers();
    users.add(user("cfo-1", "cfo@corp.test"));
    const holder: Person = {
      source: "hr",
      directoryId: "h1",
      userId: "cfo-1",
      displayName: "Casey FO",
      email: "cfo@corp.test",
      jobTitle: "Chief Financial Officer",
      department: "Finance",
    };
    const resolver = new StubResolver({ unresolved: true }, [holder]);
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      resolver,
      users,
      new StubEmbeddings(),
      new StubDocumentChunks([policyChunk("Spend above $1m is approved by the Chief Financial Officer.")]),
      new StubLanguageModel({ role: "Chief Financial Officer" }),
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(resolver.lastLookup?.role).toBe("Chief Financial Officer");
    expect(result.data?.approval.suggestedApproverUserId).toBe("cfo-1");
  });

  it("dynamic: falls back to roleHint when no chunks are retrieved", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "SES Band 2" } }));
    const resolver = new StubResolver({ unresolved: true }, []);
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      resolver,
      new InMemoryUsers(),
      new StubEmbeddings(),
      new StubDocumentChunks([]),
      new StubLanguageModel({ role: "should not be used" }),
    );

    await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(resolver.lastLookup?.role).toBe("SES Band 2");
  });

  it("dynamic: falls back to roleHint when LLM extraction returns an empty object", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "SES Band 2" } }));
    const resolver = new StubResolver({ unresolved: true }, []);
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      resolver,
      new InMemoryUsers(),
      new StubEmbeddings(),
      new StubDocumentChunks([policyChunk("Delegations are listed in the schedule.")]),
      new StubLanguageModel({}),
    );

    await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(resolver.lastLookup?.role).toBe("SES Band 2");
  });

  it("rejects a node that is not an approval node", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ type: "conversational" }));
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      new StubResolver({ unresolved: true }),
      new InMemoryUsers(),
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
