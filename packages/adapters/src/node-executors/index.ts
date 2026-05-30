import type { INodeExecutor } from "@rbrasier/domain";
import { MockNodeExecutor } from "./mock-node-executor";
import { N8nNodeExecutor } from "./n8n-node-executor";

export * from "./mock-node-executor";
export * from "./n8n-node-executor";

// N8nNodeExecutor when a shared webhook secret is configured, else the mock
// double for local dev/test (ADR-013 §7).
export const createNodeExecutor = (webhookSecret?: string | null): INodeExecutor =>
  webhookSecret ? new N8nNodeExecutor(webhookSecret) : new MockNodeExecutor();
