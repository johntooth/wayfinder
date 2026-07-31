import {
  WorkflowController,
  buildContainer,
  type WorkflowContainer,
} from "@redline/redline-web";
import { ok, type Result } from "@redline/redline-domain";
import type {
  IEvaluationRepository,
  IFinancialExtractor,
  ILanguageModel,
  IProcurementClassifier,
  IProcurementExtractionReader,
} from "@redline/redline-domain";

// redline's UI mount (ADR-0019, delivery-plan item 3 step 3), factored out of
// container.ts the way container-extraction.ts is: it wires redline's
// WorkflowController and hands it back for the fork's container to expose as
// `redline.workflowController` — the seam the evaluation router (step 2) reads.
//
// Option A of the step: the ports that already have production adapters
// (IEvaluationRepository over the redline_ schema, IProcurementExtractionReader
// over the womblex-ingest JSON seam) and the ones that do not yet
// (IProcurementClassifier — the cold-start path's store + adjudicator; the
// money-sidecar IFinancialExtractor of item 2; the summary ILanguageModel) all
// cross this module boundary as injected dependencies. The module composes them
// into a controller through buildContainer's own validation; it never
// constructs a port itself, so no not-yet-built adapter is invented here. The
// caller resolves each port as its adapter lands (items 1, 2, 4).

export interface RedlineModuleDependencies {
  readonly repository: IEvaluationRepository;
  readonly classifier: IProcurementClassifier;
  readonly financialExtractor: IFinancialExtractor;
  readonly extractionReader: IProcurementExtractionReader;
  readonly languageModel: ILanguageModel;
  readonly productName: string;
}

export interface RedlineModule {
  readonly workflowController: WorkflowController;
}

// Returns a Result because buildContainer validates the container parts (a blank
// product name is rejected there); the fork's container surfaces the controller
// only once the parts compose, so the failure rides the type boundary rather
// than throwing across it.
export const buildRedlineModule = (
  dependencies: RedlineModuleDependencies,
): Result<RedlineModule> => {
  const container: Result<WorkflowContainer> = buildContainer({
    repository: dependencies.repository,
    classifier: dependencies.classifier,
    financialExtractor: dependencies.financialExtractor,
    extractionReader: dependencies.extractionReader,
    languageModel: dependencies.languageModel,
    productName: dependencies.productName,
  });
  if (container.error) return container;

  return ok({ workflowController: new WorkflowController(container.data) });
};
