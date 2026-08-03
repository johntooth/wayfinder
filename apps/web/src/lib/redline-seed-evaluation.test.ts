import { describe, it, expect } from "vitest";
import { ok, err, domainError } from "@redline/redline-domain";
import type {
  ClassificationLensDefinition,
  Evaluation,
  IClassificationLensWriter,
  IEvaluationRepository,
  IFinancialExtractor,
  ILanguageModel,
  IProcurementClassifier,
  IProcurementExtractionReader,
  ProcurementResponse,
  ResponseGroup,
  Vendor,
} from "@redline/redline-domain";
import { IngestDocuments } from "@redline/redline-application";
import { WorkflowController } from "@redline/redline-web";
import { parseCorpusManifest } from "./redline-corpus-manifest";
import { seedEvaluation } from "./redline-seed-evaluation";

// The exit test for delivery-plan §2 item 1, in unit form: a manifest goes in,
// and an evaluation comes out whose responses are non-empty and whose stage is
// `review` — the state the served review grid reads. The driver script is a thin
// argv/env wrapper over this, so this is where the vertical is actually proven.

class InMemoryRepository implements IEvaluationRepository {
  private evaluations = new Map<string, Evaluation>();
  private vendors = new Map<string, Vendor[]>();
  private groups = new Map<string, ResponseGroup[]>();
  private responses = new Map<string, ProcurementResponse[]>();

  async saveEvaluation(evaluation: Evaluation) {
    this.evaluations.set(evaluation.id, evaluation);
    return ok(evaluation);
  }
  async findEvaluation(evaluationId: string) {
    const found = this.evaluations.get(evaluationId);
    return found ? ok(found) : err(domainError("NOT_FOUND", `no evaluation ${evaluationId}`));
  }
  async saveVendor(evaluationId: string, vendor: Vendor) {
    const list = this.vendors.get(evaluationId) ?? [];
    this.vendors.set(evaluationId, [...list.filter((existing) => existing.id !== vendor.id), vendor]);
    return ok(vendor);
  }
  async listVendors(evaluationId: string) {
    return ok(this.vendors.get(evaluationId) ?? []);
  }
  async saveResponseGroup(group: ResponseGroup) {
    const list = this.groups.get(group.evaluationId) ?? [];
    this.groups.set(group.evaluationId, [...list.filter((existing) => existing.id !== group.id), group]);
    return ok(group);
  }
  async listResponseGroups(evaluationId: string) {
    return ok(this.groups.get(evaluationId) ?? []);
  }
  async saveResponses(responses: readonly ProcurementResponse[]) {
    for (const response of responses) {
      const list = this.responses.get(response.evaluationId) ?? [];
      this.responses.set(response.evaluationId, [...list, response]);
    }
    return ok(responses);
  }
  async listResponses(evaluationId: string) {
    return ok(this.responses.get(evaluationId) ?? []);
  }
}

class RecordingLensWriter implements IClassificationLensWriter {
  readonly saved: ClassificationLensDefinition[] = [];
  failWith: ReturnType<typeof domainError> | null = null;

  async saveLens(definition: ClassificationLensDefinition) {
    if (this.failWith) return err(this.failWith);
    this.saved.push(definition);
    return ok(undefined);
  }
}

const classifier: IProcurementClassifier = {
  async classifyResponseGroup(request) {
    return ok(
      request.documentIds.map((documentId) => ({
        documentId,
        requirementId: "topic-safety",
        confidence: 0.9,
        sourceChunkId: `${documentId}:0`,
      })),
    );
  },
};

const financialExtractor: IFinancialExtractor = {
  async extractFinancials(request) {
    return ok(
      request.documentIds.map((documentId) => ({
        documentId,
        requirementId: "topic-safety",
        elementOrder: 3,
        estimateAud: 1000,
        description: "",
      })),
    );
  },
};

const extractionReader: IProcurementExtractionReader = {
  async readElements() {
    return ok([]);
  },
  async readChunks() {
    return ok([{ chunkId: "c-1", documentId: "docA1", text: "a matched passage" }]);
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

const manifestSource = {
  evaluationId: "eval-tender-42",
  evaluationName: "Tender 42 — light fleet",
  lens: {
    lensId: "lens-fleet",
    name: "Fleet procurement",
    topics: [{ id: "topic-safety", name: "Safety", definition: "Crash-worthiness and ratings." }],
    rules: [{ id: "rule-1", pattern: "SEC-*", topicId: "topic-safety" }],
  },
  vendors: [
    { id: "vendor-a", displayName: "Aurora Motors" },
    { id: "vendor-b", displayName: "Borealis Fleet" },
  ],
  groups: [
    { id: "group-a", label: "Aurora response", vendorIds: ["vendor-a"], documentIds: ["docA1", "docA2"] },
    { id: "group-b", label: "Borealis response", vendorIds: ["vendor-b"], documentIds: ["docB1"] },
  ],
};

const manifest = () => {
  const parsed = parseCorpusManifest(manifestSource);
  if (parsed.error) throw new Error(`bad test manifest: ${parsed.error.message}`);
  return parsed.data;
};

const dependencies = () => {
  const repository = new InMemoryRepository();
  const lensWriter = new RecordingLensWriter();
  return {
    repository,
    lensWriter,
    ingestDocuments: new IngestDocuments({ repository, extractionReader }),
    workflowController: new WorkflowController({
      repository,
      classifier,
      financialExtractor,
      extractionReader,
      languageModel,
      productName: "Light fleet",
    }),
  };
};

describe("seedEvaluation — the corpus write path", () => {
  it("creates an evaluation, groups it, builds the table and lands at review", async () => {
    const parts = dependencies();

    const seeded = await seedEvaluation(manifest(), parts);

    expect(seeded.error).toBeUndefined();
    expect(seeded.data?.evaluationId).toBe("eval-tender-42");
    expect(seeded.data?.stage).toBe("review");
    expect(seeded.data?.responseCount).toBeGreaterThan(0);
  });

  it("leaves listResponses non-empty — what the served review grid reads", async () => {
    const parts = dependencies();

    await seedEvaluation(manifest(), parts);

    const responses = await parts.repository.listResponses("eval-tender-42");
    expect(responses.data?.length).toBeGreaterThan(0);
  });

  it("persists the vendors and response groups the manifest declares", async () => {
    const parts = dependencies();

    await seedEvaluation(manifest(), parts);

    const vendors = await parts.repository.listVendors("eval-tender-42");
    const groups = await parts.repository.listResponseGroups("eval-tender-42");
    expect(vendors.data?.map((vendor) => vendor.id).sort()).toEqual(["vendor-a", "vendor-b"]);
    expect(groups.data?.map((group) => group.id).sort()).toEqual(["group-a", "group-b"]);
  });

  it("seeds the lens before classification, or the classifier has none to read", async () => {
    const parts = dependencies();

    await seedEvaluation(manifest(), parts);

    expect(parts.lensWriter.saved).toHaveLength(1);
    expect(parts.lensWriter.saved[0]?.lensId).toBe("lens-fleet");
    expect(parts.lensWriter.saved[0]?.evaluationId).toBe("eval-tender-42");
  });

  it("stops at the lens when it cannot be written, rather than classifying blind", async () => {
    const parts = dependencies();
    parts.lensWriter.failWith = domainError("INFRA_FAILURE", "no database");

    const seeded = await seedEvaluation(manifest(), parts);

    expect(seeded.error?.code).toBe("INFRA_FAILURE");
    const responses = await parts.repository.listResponses("eval-tender-42");
    expect(responses.data).toEqual([]);
  });

  it("assigns every document to the group that claims it", async () => {
    const parts = dependencies();

    await seedEvaluation(manifest(), parts);

    const groups = await parts.repository.listResponseGroups("eval-tender-42");
    const byId = new Map(groups.data?.map((group) => [group.id, group.documentIds]));
    expect(byId.get("group-a")).toEqual(["docA1", "docA2"]);
    expect(byId.get("group-b")).toEqual(["docB1"]);
  });

  it("is re-runnable: a second seed of the same manifest still lands at review", async () => {
    const parts = dependencies();
    await seedEvaluation(manifest(), parts);

    const reseeded = await seedEvaluation(manifest(), parts);

    expect(reseeded.error).toBeUndefined();
    expect(reseeded.data?.stage).toBe("review");
  });
});
