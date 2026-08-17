import {
  buildFlowSnapshot,
  domainError,
  err,
  ok,
  type Flow,
  type FlowSnapshot,
  type FlowVersion,
  type IAuditLogger,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
  type IFlowVersionRepository,
  type FlowNode,
  type Result,
} from "@rbrasier/domain";

// An imported flow whose skills or MCP tools did not resolve carries them on the
// nodes that wanted them (ADR-049 §4). Publishing such a flow would put a step
// into production with a reference that silently does nothing, so it is refused
// until an author picks a local replacement or removes the step's need for it.
const describeUnresolvedDependencies = (nodes: FlowNode[]): string[] =>
  nodes.flatMap((node) => {
    const unresolved = node.config.unresolvedDependencies;
    if (!Array.isArray(unresolved) || unresolved.length === 0) return [];

    return unresolved.map((dependency) => {
      const reference = dependency as { kind?: string; name?: string; toolName?: string };
      const what =
        reference.kind === "mcp_tool"
          ? `MCP tool "${reference.toolName}" on server "${reference.name}"`
          : `skill "${reference.name}"`;
      return `${node.name} needs ${what}`;
    });
  });

export interface PublishFlowVersionInput {
  flowId: string;
  publishedByUserId: string;
  changeSummary?: string | null;
}

// Promotes the flow's open draft (or records a fresh published version) by
// assembling an immutable snapshot of the current live definition. Hooked into
// the `status:"published"` transition on flow.update (ADR-015).
export class PublishFlowVersion {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly flowVersions: IFlowVersionRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: PublishFlowVersionInput): Promise<Result<FlowVersion>> {
    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));

    // The one shared-code touchpoint (ADR-033 §3): a guided flow snapshots its
    // live nodes/edges; an extraction flow's schema already lives in the open
    // draft snapshot, so publishing promotes that draft as-is.
    const snapshotResult =
      flowResult.data.flowType === "extraction"
        ? await this.extractionSnapshot(input.flowId)
        : await this.guidedSnapshot(flowResult.data);
    if (snapshotResult.error) return snapshotResult;

    const snapshot = snapshotResult.data;
    const published = await this.flowVersions.createPublished({
      flowId: input.flowId,
      snapshot,
      publishedByUserId: input.publishedByUserId,
      changeSummary: input.changeSummary ?? null,
    });
    if (published.error) return published;

    await this.auditLogger.log({
      actorId: input.publishedByUserId,
      action: "flow.version.published",
      resourceType: "flow",
      resourceId: input.flowId,
      metadata: {
        versionId: published.data.id,
        versionNumber: published.data.versionNumber,
        changeSummary: published.data.changeSummary,
      },
    });

    return ok(published.data);
  }

  private async guidedSnapshot(flow: Flow): Promise<Result<FlowSnapshot>> {
    const [nodesResult, edgesResult] = await Promise.all([
      this.flowNodes.listByFlow(flow.id),
      this.flowEdges.listByFlow(flow.id),
    ]);
    if (nodesResult.error) return nodesResult;
    if (edgesResult.error) return edgesResult;

    const unresolved = describeUnresolvedDependencies(nodesResult.data);
    if (unresolved.length > 0) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `This flow cannot be published until every imported reference is resolved. Still missing: ${unresolved.join("; ")}.`,
        ),
      );
    }

    return ok(buildFlowSnapshot(flow, nodesResult.data, edgesResult.data));
  }

  private async extractionSnapshot(flowId: string): Promise<Result<FlowSnapshot>> {
    const draft = await this.flowVersions.openDraft(flowId);
    if (draft.error) return draft;
    if (!draft.data) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "Configure the extraction schema before publishing this flow.",
        ),
      );
    }
    return ok(draft.data.snapshot);
  }
}
