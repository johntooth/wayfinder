import { describe, expect, it } from "vitest";
import type { NodeExecutionInput } from "@rbrasier/domain";
import { MockNodeExecutor } from "./mock-node-executor";

describe("MockNodeExecutor", () => {
  const executor = new MockNodeExecutor();

  const baseInput: NodeExecutionInput = {
    nodeId: "node-1",
    sessionId: "session-abc",
    userId: "user-xyz",
    userRole: "user",
    flowId: "flow-001",
    flowSlug: "procurement-flow",
    sessionTitle: "Buy laptops",
    instruction: "Look up the preferred vendor.",
    correlationId: "corr-1",
    webhookUrl: "https://n8n.example.com/webhook/abc",
    fields: { category: "IT Hardware" },
  };

  it("returns completed status for any nodeId", async () => {
    const result = await executor.execute(baseInput);

    expect(result.error).toBeUndefined();
    expect(result.data!.status).toBe("completed");
  });

  it("echoes the gathered fields back in the data record", async () => {
    const result = await executor.execute(baseInput);

    expect(result.data!.data["category"]).toBe("IT Hardware");
    expect(result.data!.data["correlationId"]).toBe("corr-1");
  });

  it("accepts admin role", async () => {
    const result = await executor.execute({ ...baseInput, userRole: "admin" });

    expect(result.error).toBeUndefined();
    expect(result.data!.status).toBe("completed");
  });

  it("reflects the nodeId in the output data", async () => {
    const result = await executor.execute({ ...baseInput, nodeId: "custom-node-42" });

    expect(result.data!.data["nodeId"]).toBe("custom-node-42");
  });
});
