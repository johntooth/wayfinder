import type { TemplateField } from "../entities/template-field";
import type { Result } from "../result";

export interface NodeExecutionInput {
  nodeId: string;
  sessionId: string;
  userId: string;
  userRole: "admin" | "user";
  flowId: string;
  flowSlug: string;
  sessionTitle: string;
  instruction: string;
  correlationId: string;
  webhookUrl: string;
  // Keyed by TemplateField.key — gathered from the session and sent to n8n.
  fields: Record<string, string>;
  // The declared response schema. The mock executor uses it to shape an
  // AI-generated response; the n8n executor ignores it (the real result arrives
  // via the callback).
  responseFields?: TemplateField[];
}

export interface NodeExecutionOutput {
  // pending_approval remains in the union but is unused this phase (the approval
  // gate is deferred). An async executor returns "pending" — the real result
  // arrives later via the inbound webhook callback.
  status: "completed" | "pending" | "pending_approval" | "failed";
  data: Record<string, unknown>;
  message?: string;
}

export interface INodeExecutor {
  execute(input: NodeExecutionInput): Promise<Result<NodeExecutionOutput>>;
}
