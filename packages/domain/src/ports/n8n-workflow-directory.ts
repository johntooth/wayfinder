import type { N8nWorkflowSummary } from "../entities/n8n-workflow";
import type { Result } from "../result";

export interface IN8nWorkflowDirectory {
  listWorkflows(): Promise<Result<N8nWorkflowSummary[]>>;
}
