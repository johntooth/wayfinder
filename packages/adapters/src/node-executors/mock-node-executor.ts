import type {
  INodeExecutor,
  NodeExecutionInput,
  NodeExecutionOutput,
  Result,
} from "@rbrasier/domain";

// Dev/test double for INodeExecutor. Completes synchronously and echoes the
// gathered fields back as the result so an auto node can be exercised locally
// without a running n8n instance.
export class MockNodeExecutor implements INodeExecutor {
  async execute(input: NodeExecutionInput): Promise<Result<NodeExecutionOutput>> {
    return {
      data: {
        status: "completed",
        data: {
          nodeId: input.nodeId,
          sessionId: input.sessionId,
          correlationId: input.correlationId,
          ...input.fields,
        },
        message: `Node ${input.nodeId} executed (mock).`,
      },
    };
  }
}
