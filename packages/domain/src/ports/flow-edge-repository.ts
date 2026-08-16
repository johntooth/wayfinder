import type { FlowEdge, NewFlowEdge } from "../entities/flow-edge";
import type { Result } from "../result";

export interface IFlowEdgeRepository {
  create(input: NewFlowEdge): Promise<Result<FlowEdge>>;
  listByFlow(flowId: string): Promise<Result<FlowEdge[]>>;
  findById(id: string): Promise<Result<FlowEdge | null>>;
  updateConfig(id: string, config: Record<string, unknown>): Promise<Result<FlowEdge>>;
  delete(id: string): Promise<Result<true>>;
}
