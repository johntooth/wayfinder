import { ok, type IntakeStage, type Result } from "@redline/redline-domain";
import type { IClassificationLensWriter, IEvaluationRepository } from "@redline/redline-domain";
import type { IngestDocuments } from "@redline/redline-application";
import type { WorkflowController, WorkflowManager } from "@redline/redline-web";
import type { CorpusManifest } from "./redline-corpus-manifest";

// seedEvaluation — the vertical's missing middle (delivery-plan §2 item 1).
//
// The store-load path fills redline_chunks and the review grid reads persisted
// ProcurementResponse[]; nothing joined them, because IngestDocuments was called
// by nothing outside its own test and WorkflowController.buildTable was reachable
// from no served procedure. This is that join: manifest in, an evaluation at the
// `review` stage out, with the rows the grid reads persisted behind it.
//
// The lens is written between ingest and grouping and not before: the binding
// row references the evaluation, so the evaluation has to exist first — and it
// has to exist BEFORE classification, or the lens reader resolves NOT_FOUND and
// the classifier has nothing to reason with.

export interface SeedEvaluationDependencies {
  readonly repository: IEvaluationRepository;
  readonly ingestDocuments: IngestDocuments;
  readonly lensWriter: IClassificationLensWriter;
  readonly workflowController: WorkflowController;
}

export interface SeedEvaluationOutcome {
  readonly evaluationId: string;
  readonly stage: IntakeStage;
  readonly responseCount: number;
}

const composeVendors = (manager: WorkflowManager, manifest: CorpusManifest): Result<void> => {
  for (const vendor of manifest.vendors) {
    const added = manager.addVendor(vendor);
    if (added.error) return added;
  }
  return ok(undefined);
};

const composeGroup = (
  manager: WorkflowManager,
  group: CorpusManifest["groups"][number],
): Result<void> => {
  const created = manager.createGroup({
    id: group.id,
    label: group.label,
    vendorIds: group.vendorIds,
  });
  if (created.error) return created;

  for (const documentId of group.documentIds) {
    const assigned = manager.assignDocument(group.id, documentId);
    if (assigned.error) return assigned;
  }
  return ok(undefined);
};

const composeGroups = (manager: WorkflowManager, manifest: CorpusManifest): Result<void> => {
  const vendors = composeVendors(manager, manifest);
  if (vendors.error) return vendors;

  for (const group of manifest.groups) {
    const composed = composeGroup(manager, group);
    if (composed.error) return composed;
  }
  return ok(undefined);
};

export const seedEvaluation = async (
  manifest: CorpusManifest,
  dependencies: SeedEvaluationDependencies,
): Promise<Result<SeedEvaluationOutcome>> => {
  const ingested = await dependencies.ingestDocuments.execute({
    evaluationId: manifest.evaluationId,
    evaluationName: manifest.evaluationName,
    documentIds: manifest.documentIds,
  });
  if (ingested.error) return ingested;

  const lens = await dependencies.lensWriter.saveLens(manifest.lens);
  if (lens.error) return lens;

  const manager = await dependencies.workflowController.openWorkflow({
    evaluationId: manifest.evaluationId,
    documentIds: manifest.documentIds,
  });
  if (manager.error) return manager;

  const composed = composeGroups(manager.data, manifest);
  if (composed.error) return composed;

  const advanced = await dependencies.workflowController.advance(manager.data);
  if (advanced.error) return advanced;

  const responses = await dependencies.workflowController.buildTable({
    evaluationId: manifest.evaluationId,
  });
  if (responses.error) return responses;

  // Read the stage back rather than asserting it: BuildEvaluationTable owns the
  // transition, so the store is the only honest answer to where this landed.
  const evaluation = await dependencies.repository.findEvaluation(manifest.evaluationId);
  if (evaluation.error) return evaluation;

  return ok({
    evaluationId: manifest.evaluationId,
    stage: evaluation.data.stage,
    responseCount: responses.data.length,
  });
};
