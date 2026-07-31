import { describe, expect, it } from "vitest";
import { err, ok, domainError, isErr } from "@redline/redline-domain";
import type {
  Adjudication,
  AdjudicationRequest,
  ChunkRow,
  Evaluation,
  IAdjudicator,
  IChunkStore,
  IEvaluationRepository,
  IFinancialExtractor,
  ILanguageModel,
  IProcurementClassifier,
  IProcurementExtractionReader,
  ProcurementResponse,
  Result,
  ResponseGroup,
  ScoredChunkRef,
  Topic,
  Vendor,
} from "@redline/redline-domain";
import { buildColdStartClassifier } from "@redline/redline-web";
import { buildRedlineModule, type RedlineModuleDependencies } from "./container-redline";

// Item 3 step 3 (ADR-0019): container-redline.ts wires a real
// WorkflowController onto the fork's container as `redline.workflowController` —
// the seam the evaluation router (step 2) reads. This proves the module
// produces a controller from injected ports and surfaces the read-side
// procedures the router drives, without inventing the not-yet-built adapters
// (the cold-start chunk store / adjudicator, the money extractor). Those cross
// the module boundary as injected dependencies, exactly as the extraction
// module takes its ports.

const evaluationId = "eval-1";

class InMemoryRepository implements IEvaluationRepository {
  private readonly evaluations = new Map<string, Evaluation>();
  private readonly responses = new Map<string, ProcurementResponse[]>();

  seedEvaluation(evaluation: Evaluation) {
    this.evaluations.set(evaluation.id, evaluation);
  }
  seedResponses(id: string, responses: readonly ProcurementResponse[]) {
    this.responses.set(id, [...responses]);
  }

  async saveEvaluation(evaluation: Evaluation) {
    this.evaluations.set(evaluation.id, evaluation);
    return ok(evaluation);
  }
  async findEvaluation(id: string) {
    const found = this.evaluations.get(id);
    return found ? ok(found) : err(domainError("NOT_FOUND", `no evaluation ${id}`));
  }
  async saveVendor(_id: string, vendor: Vendor) {
    return ok(vendor);
  }
  async listVendors() {
    return ok([]);
  }
  async saveResponseGroup(group: ResponseGroup) {
    return ok(group);
  }
  async listResponseGroups() {
    return ok([]);
  }
  async saveResponses(responses: readonly ProcurementResponse[]) {
    return ok(responses);
  }
  async listResponses(id: string) {
    return ok(this.responses.get(id) ?? []);
  }
}

class FakeChunkStore implements IChunkStore {
  async fetchChunks(): Promise<Result<readonly ChunkRow[]>> {
    return ok([]);
  }
  async fetchByStructure(): Promise<Result<readonly ChunkRow[]>> {
    return ok([]);
  }
  async findSimilar(): Promise<Result<readonly ScoredChunkRef[]>> {
    return err(domainError("NOT_IMPLEMENTED", "deferred (ADR-0018 addendum)"));
  }
}

const adjudicator: IAdjudicator = {
  async adjudicate(request: AdjudicationRequest): Promise<Result<Adjudication>> {
    return ok({
      documentId: request.documentId,
      chosenTopicId: request.candidates[0]?.topicId ?? "req-1",
      rationale: "",
    });
  },
};

const topics: readonly Topic[] = [
  { id: "req-1", name: "Support", definition: "support services" },
  { id: "req-2", name: "Hosting", definition: "hosting services" },
];

const financialExtractor: IFinancialExtractor = {
  async extractFinancials() {
    return ok([]);
  },
};

const extractionReader: IProcurementExtractionReader = {
  async readElements() {
    return ok([]);
  },
  async readChunks() {
    return ok([]);
  },
  async readTableCells() {
    return ok([]);
  },
};

const languageModel: ILanguageModel = {
  async summarise() {
    return ok("A concise one-paragraph summary.");
  },
};

const classifier: IProcurementClassifier = buildColdStartClassifier({
  chunkStore: new FakeChunkStore(),
  adjudicator,
  topics,
  ruleSet: { rules: [] },
  candidates: [],
});

const dependencies = (overrides: Partial<RedlineModuleDependencies> = {}): RedlineModuleDependencies => ({
  repository: new InMemoryRepository(),
  classifier,
  financialExtractor,
  extractionReader,
  languageModel,
  productName: "Platform",
  ...overrides,
});

const seededRepository = () => {
  const repository = new InMemoryRepository();
  const evaluation: Evaluation = { id: evaluationId, name: "Tender 2026", stage: "review" };
  repository.seedEvaluation(evaluation);
  repository.seedResponses(evaluationId, [
    {
      evaluationId,
      responseGroupId: "g-acme",
      vendorName: "Acme",
      productName: "Platform",
      requirementId: "req-1",
      confidence: 0.9,
      productSummary: "A concise summary.",
      costing: { estimateAud: 1500.5, description: "" },
      source: { documentId: "doc-1", elementOrder: 7, page: 3, chunkId: "doc-1:2" },
    },
  ]);
  return repository;
};

describe("buildRedlineModule", () => {
  it("exposes a workflow controller the evaluation router binds to", () => {
    const module = buildRedlineModule(dependencies());
    expect(isErr(module)).toBe(false);
    if (isErr(module)) return;
    expect(module.data.workflowController.openReviewGrid).toBeTypeOf("function");
    expect(module.data.workflowController.openPricingPivot).toBeTypeOf("function");
    expect(module.data.workflowController.buildWorkbook).toBeTypeOf("function");
  });

  it("refuses a blank product name at the boundary (buildContainer's guard)", () => {
    const module = buildRedlineModule(dependencies({ productName: "   " }));
    expect(isErr(module)).toBe(true);
    if (!isErr(module)) return;
    expect(module.error.code).toBe("VALIDATION_FAILED");
  });

  it("opens the review grid over the injected repository's persisted responses", async () => {
    const module = buildRedlineModule(dependencies({ repository: seededRepository() }));
    if (isErr(module)) throw new Error("module failed to build");

    const grid = await module.data.workflowController.openReviewGrid({ evaluationId });
    expect(isErr(grid)).toBe(false);
    if (isErr(grid)) return;
    const rows = grid.data.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cells.estimateAud.sortValue).toBe(1500.5);
  });

  it("rolls up a pricing pivot over the same persisted responses", async () => {
    const module = buildRedlineModule(dependencies({ repository: seededRepository() }));
    if (isErr(module)) throw new Error("module failed to build");

    const pivot = await module.data.workflowController.openPricingPivot({ evaluationId });
    expect(isErr(pivot)).toBe(false);
    if (isErr(pivot)) return;
    const rolled = pivot.data.compute({ axis: "brand", measure: "sum" });
    expect(rolled.grandTotal.value).toBe(1500.5);
  });

  it("builds the export workbook over the same persisted responses", async () => {
    const module = buildRedlineModule(dependencies({ repository: seededRepository() }));
    if (isErr(module)) throw new Error("module failed to build");

    const workbook = await module.data.workflowController.buildWorkbook({ evaluationId });
    expect(isErr(workbook)).toBe(false);
    if (isErr(workbook)) return;
    expect(workbook.data.sheetNames[0]).toBe("Review");
  });
});
