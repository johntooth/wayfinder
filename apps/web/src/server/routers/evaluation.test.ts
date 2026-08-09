import { describe, expect, it, vi } from "vitest";
import { err, ok, domainError } from "@redline/redline-domain";
import type { PermissionKey } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { evaluationRouter } from "./evaluation";

const createCaller = createCallerFactory(router({ evaluation: evaluationRouter }));

const evaluationId = "00000000-0000-4000-8000-000000000001";

const makeController = (
  overrides: {
    listEvaluations?: ReturnType<typeof vi.fn>;
    openReviewGrid?: ReturnType<typeof vi.fn>;
    openPricingPivot?: ReturnType<typeof vi.fn>;
    buildWorkbook?: ReturnType<typeof vi.fn>;
    openDocument?: ReturnType<typeof vi.fn>;
    listStagedCorpora?: ReturnType<typeof vi.fn>;
    listStagedDocuments?: ReturnType<typeof vi.fn>;
    createEvaluation?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  return {
    openDocument:
      overrides.openDocument ??
      vi
        .fn()
        .mockResolvedValue(
          ok([{ documentId: "doc-1", elementOrder: 7, page: 3, text: "the cited passage" }]),
        ),
    listEvaluations:
      overrides.listEvaluations ??
      vi.fn().mockResolvedValue(ok([{ id: evaluationId, name: "Tender 2026", stage: "review" }])),
    openReviewGrid:
      overrides.openReviewGrid ??
      vi.fn().mockResolvedValue(ok({ view: () => [], requirementIds: () => ["req-1"] })),
    openPricingPivot:
      overrides.openPricingPivot ??
      vi.fn().mockResolvedValue(
        ok({
          compute: () => ({
            primaryGroups: ["Acme"],
            secondaryGroups: null,
            rows: [{ key: "Acme", cells: [{ value: 1200, sampleCount: 1 }], total: { value: 1200, sampleCount: 1 } }],
            columnTotals: [{ value: 1200, sampleCount: 1 }],
            grandTotal: { value: 1200, sampleCount: 1 },
            hasNumericData: true,
          }),
        }),
      ),
    buildWorkbook:
      overrides.buildWorkbook ??
      vi.fn().mockResolvedValue(ok({ sheets: [[]], sheetNames: ["Review"] })),
    listStagedCorpora:
      overrides.listStagedCorpora ??
      vi.fn().mockResolvedValue(ok([{ corpusId: "tender-2026", documentCount: 2 }])),
    listStagedDocuments:
      overrides.listStagedDocuments ??
      vi.fn().mockResolvedValue(
        ok([{ documentId: "hashA", chunkCount: 3, preview: "Response of Acme" }]),
      ),
    createEvaluation:
      overrides.createEvaluation ??
      vi
        .fn()
        .mockResolvedValue(ok({ id: "tender-2026", name: "Panel 2026", stage: "documents_uploaded" })),
  };
};

const makeContainer = (controller: ReturnType<typeof makeController>) =>
  ({
    services: { errorLogger: { log: async () => undefined } },
    redline: { workflowController: controller },
  }) as unknown as Container;

const contextWith = (container: Container): TrpcContext => ({
  container,
  userId: "user-1",
  isAdmin: true,
  permissions: new Set(),
  headers: new Headers(),
});

describe("evaluation.list", () => {
  it("returns every evaluation the index lists, newest first", async () => {
    const controller = makeController({
      listEvaluations: vi.fn().mockResolvedValue(
        ok([
          { id: evaluationId, name: "Tender 2026", stage: "review" },
          { id: "00000000-0000-4000-8000-000000000002", name: "Panel refresh", stage: "grouping" },
        ]),
      ),
    });

    const result = await createCaller(contextWith(makeContainer(controller))).evaluation.list();

    expect(controller.listEvaluations).toHaveBeenCalled();
    expect(result.map((evaluation) => evaluation.name)).toEqual(["Tender 2026", "Panel refresh"]);
    expect(result[0]?.stage).toBe("review");
  });

  it("returns an empty list rather than an error when nothing has been evaluated yet", async () => {
    const controller = makeController({ listEvaluations: vi.fn().mockResolvedValue(ok([])) });

    const result = await createCaller(contextWith(makeContainer(controller))).evaluation.list();

    expect(result).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    const controller = makeController();
    const context = { ...contextWith(makeContainer(controller)), userId: null };

    await expect(createCaller(context).evaluation.list()).rejects.toThrow(/authentication required/i);
    expect(controller.listEvaluations).not.toHaveBeenCalled();
  });

  it("refuses a caller lacking the evaluation:review permission", async () => {
    const controller = makeController();
    const context = {
      ...contextWith(makeContainer(controller)),
      isAdmin: false,
      permissions: new Set<PermissionKey>(),
    };

    await expect(createCaller(context).evaluation.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(controller.listEvaluations).not.toHaveBeenCalled();
  });

  it("admits a non-admin caller holding evaluation:review", async () => {
    const controller = makeController();
    const context = {
      ...contextWith(makeContainer(controller)),
      isAdmin: false,
      permissions: new Set<PermissionKey>(["evaluation:review"]),
    };

    await expect(createCaller(context).evaluation.list()).resolves.toBeDefined();
    expect(controller.listEvaluations).toHaveBeenCalled();
  });

  it("maps a redline domain error to a tRPC error, message intact", async () => {
    const controller = makeController({
      listEvaluations: vi
        .fn()
        .mockResolvedValue(err(domainError("INFRA_FAILURE", "failed to list evaluations"))),
    });

    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.list(),
    ).rejects.toThrow(/failed to list evaluations/i);
  });

  // container.ts leaves `redline` null when REDLINE_* is unset, so the fork
  // still boots as plain Wayfinder. The index is the first surface a tester
  // reaches, so that state has to read as configuration rather than as a
  // TypeError on a null dereference.
  it("says the stack is unconfigured when the fork booted without redline", async () => {
    const context = contextWith({
      services: { errorLogger: { log: async () => undefined } },
      redline: null,
    } as unknown as Container);

    await expect(createCaller(context).evaluation.list()).rejects.toThrow(/not configured/i);
  });
});

describe("evaluation.reviewGrid", () => {
  it("renders the review grid view for the evaluation", async () => {
    const controller = makeController();
    const result = await createCaller(contextWith(makeContainer(controller))).evaluation.reviewGrid({
      evaluationId,
    });

    expect(controller.openReviewGrid).toHaveBeenCalledWith({ evaluationId });
    expect(result.headers.length).toBeGreaterThan(0);
    expect(result.requirementFilterOptions).toEqual(["req-1"]);
  });

  it("forwards the sort and filter to the grid's server-side view shaping", async () => {
    const view = vi.fn().mockReturnValue([]);
    const controller = makeController({
      openReviewGrid: vi.fn().mockResolvedValue(ok({ view, requirementIds: () => ["req-1"] })),
    });
    const sort = { key: "estimateAud", direction: "desc" } as const;
    const filter = { query: "acme", requirementId: "req-1" };

    await createCaller(contextWith(makeContainer(controller))).evaluation.reviewGrid({
      evaluationId,
      sort,
      filter,
    });

    expect(view).toHaveBeenCalledWith({ sort, filter });
  });

  it("rejects a sort key that is not a review column", async () => {
    const controller = makeController();
    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.reviewGrid({
        evaluationId,
        sort: { key: "not-a-column", direction: "asc" },
      } as never),
    ).rejects.toThrow();
    expect(controller.openReviewGrid).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    const controller = makeController();
    const context = { ...contextWith(makeContainer(controller)), userId: null };
    await expect(
      createCaller(context).evaluation.reviewGrid({ evaluationId }),
    ).rejects.toThrow(/authentication required/i);
    expect(controller.openReviewGrid).not.toHaveBeenCalled();
  });

  it("refuses a caller lacking the evaluation:review permission", async () => {
    const controller = makeController();
    const context = {
      ...contextWith(makeContainer(controller)),
      isAdmin: false,
      permissions: new Set<PermissionKey>(),
    };
    await expect(
      createCaller(context).evaluation.reviewGrid({ evaluationId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(controller.openReviewGrid).not.toHaveBeenCalled();
  });

  it("admits a non-admin caller holding evaluation:review", async () => {
    const controller = makeController();
    const context = {
      ...contextWith(makeContainer(controller)),
      isAdmin: false,
      permissions: new Set<PermissionKey>(["evaluation:review"]),
    };
    await expect(
      createCaller(context).evaluation.reviewGrid({ evaluationId }),
    ).resolves.toBeDefined();
    expect(controller.openReviewGrid).toHaveBeenCalledWith({ evaluationId });
  });

  it("maps a redline domain error to a tRPC error, message intact", async () => {
    const controller = makeController({
      openReviewGrid: vi.fn().mockResolvedValue(err(domainError("NOT_FOUND", "no such evaluation"))),
    });
    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.reviewGrid({ evaluationId }),
    ).rejects.toThrow(/no such evaluation/i);
  });

  it("maps a redline-only error code the fork's own taxonomy lacks", async () => {
    const controller = makeController({
      openReviewGrid: vi
        .fn()
        .mockResolvedValue(err(domainError("NOT_IMPLEMENTED", "similarity search deferred"))),
    });
    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.reviewGrid({ evaluationId }),
    ).rejects.toThrow(/similarity search deferred/i);
  });

  // redline_evaluations.id is `text`, the domain type is `string`, and the corpus
  // manifest lets the operator author the id. A uuid() input rejected every such
  // evaluation at the router — created successfully, then unreadable.
  it("accepts an operator-authored evaluation id that is not a uuid", async () => {
    const controller = makeController();
    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.reviewGrid({
        evaluationId: "cloud-rft-2026",
      }),
    ).resolves.toBeDefined();
    expect(controller.openReviewGrid).toHaveBeenCalledWith(
      expect.objectContaining({ evaluationId: "cloud-rft-2026" }),
    );
  });

  it("still refuses an empty evaluation id", async () => {
    const controller = makeController();
    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.reviewGrid({
        evaluationId: "",
      }),
    ).rejects.toThrow();
    expect(controller.openReviewGrid).not.toHaveBeenCalled();
  });
});

describe("evaluation.pricingPivot", () => {
  it("renders the requested pivot axis and measure", async () => {
    const controller = makeController();
    const result = await createCaller(contextWith(makeContainer(controller))).evaluation.pricingPivot({
      evaluationId,
      axis: "brand",
      measure: "sum",
    });

    expect(controller.openPricingPivot).toHaveBeenCalledWith({ evaluationId });
    expect(result.axis).toBe("brand");
    expect(result.measure).toBe("sum");
    expect(result.hasNumericData).toBe(true);
  });
});

describe("evaluation.workbook", () => {
  it("returns the built export workbook", async () => {
    const controller = makeController();
    const result = await createCaller(contextWith(makeContainer(controller))).evaluation.workbook({
      evaluationId,
    });

    expect(controller.buildWorkbook).toHaveBeenCalledWith({ evaluationId });
    expect(result.sheetNames).toEqual(["Review"]);
  });
});

// The route behind every source deep-link the review grid renders (redline
// delivery-plan item 1). The pure ordering/anchor shaping is proven in redline's
// document-view.test.ts; this proves the procedure that drives it — the gate, the
// controller call, and that the `element` parameter reaches the view model.
describe("evaluation.document", () => {
  const documentId = "doc-1";

  it("renders the document view for the cited document", async () => {
    const controller = makeController();
    const result = await createCaller(contextWith(makeContainer(controller))).evaluation.document({
      evaluationId,
      documentId,
    });

    expect(controller.openDocument).toHaveBeenCalledWith({ evaluationId, documentId });
    expect(result.documentId).toBe(documentId);
    expect(result.elements.map((element) => element.elementOrder)).toEqual([7]);
    expect(result.backToReviewHref).toBe(`/evaluations/${evaluationId}/review`);
  });

  it("anchors on the element the deep-link cited", async () => {
    const controller = makeController({
      openDocument: vi.fn().mockResolvedValue(
        ok([
          { documentId, elementOrder: 7, page: 3, text: "the cited passage" },
          { documentId, elementOrder: 2, page: 1, text: "an earlier paragraph" },
        ]),
      ),
    });

    const result = await createCaller(contextWith(makeContainer(controller))).evaluation.document({
      evaluationId,
      documentId,
      element: 7,
    });

    expect(result.anchorDomId).toBe("element-7");
    expect(result.anchorMissing).toBe(false);
    expect(result.anchorPage).toBe(3);
    // Ordering is the view model's, not the reader's.
    expect(result.elements.map((element) => element.elementOrder)).toEqual([2, 7]);
    expect(result.elements.map((element) => element.isAnchor)).toEqual([false, true]);
  });

  it("reports a stale deep-link rather than silently rendering the top of the document", async () => {
    const controller = makeController();
    const result = await createCaller(contextWith(makeContainer(controller))).evaluation.document({
      evaluationId,
      documentId,
      element: 99,
    });

    expect(result.anchorMissing).toBe(true);
    expect(result.anchorDomId).toBeNull();
  });

  it("rejects a negative element, which no elem_order can be", async () => {
    const controller = makeController();
    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.document({
        evaluationId,
        documentId,
        element: -1,
      }),
    ).rejects.toThrow();
    expect(controller.openDocument).not.toHaveBeenCalled();
  });

  it("rejects a blank document id", async () => {
    const controller = makeController();
    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.document({
        evaluationId,
        documentId: "",
      }),
    ).rejects.toThrow();
    expect(controller.openDocument).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    const controller = makeController();
    const context = { ...contextWith(makeContainer(controller)), userId: null };
    await expect(
      createCaller(context).evaluation.document({ evaluationId, documentId }),
    ).rejects.toThrow(/authentication required/i);
    expect(controller.openDocument).not.toHaveBeenCalled();
  });

  it("refuses a caller lacking the evaluation:review permission", async () => {
    const controller = makeController();
    const context = {
      ...contextWith(makeContainer(controller)),
      isAdmin: false,
      permissions: new Set<PermissionKey>(),
    };
    await expect(
      createCaller(context).evaluation.document({ evaluationId, documentId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(controller.openDocument).not.toHaveBeenCalled();
  });

  it("admits a non-admin caller holding evaluation:review", async () => {
    const controller = makeController();
    const context = {
      ...contextWith(makeContainer(controller)),
      isAdmin: false,
      permissions: new Set<PermissionKey>(["evaluation:review"]),
    };
    await expect(
      createCaller(context).evaluation.document({ evaluationId, documentId }),
    ).resolves.toBeDefined();
    expect(controller.openDocument).toHaveBeenCalledWith({ evaluationId, documentId });
  });

  it("maps the reader's failure to a tRPC error, message intact", async () => {
    const controller = makeController({
      openDocument: vi
        .fn()
        .mockResolvedValue(err(domainError("INFRA_FAILURE", "womblex-ingest is unreachable"))),
    });
    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.document({
        evaluationId,
        documentId,
      }),
    ).rejects.toThrow(/womblex-ingest is unreachable/i);
  });
});

// The create half (delivery-plan §2 item 1). Until these three the router had
// five queries and no mutation, so nothing served could bring an evaluation into
// being — a terminal script was the only way in.

const createInput = {
  corpusId: "tender-2026",
  name: "Panel 2026",
  documents: [{ documentId: "hashA", brand: "Acme" }],
  fields: [{ name: "Warranty", definition: "The warranty offered." }],
};

const reviewerContext = (container: Container): TrpcContext => ({
  ...contextWith(container),
  isAdmin: false,
  permissions: new Set<PermissionKey>(["evaluation:review"]),
});

describe("evaluation.stagedCorpora", () => {
  it("returns the corpora the create screen picks from", async () => {
    const controller = makeController();

    const result = await createCaller(
      contextWith(makeContainer(controller)),
    ).evaluation.stagedCorpora();

    expect(result).toEqual([{ corpusId: "tender-2026", documentCount: 2 }]);
  });

  it("refuses a reviewer, who cannot start an evaluation", async () => {
    const controller = makeController();

    await expect(
      createCaller(reviewerContext(makeContainer(controller))).evaluation.stagedCorpora(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(controller.listStagedCorpora).not.toHaveBeenCalled();
  });
});

describe("evaluation.stagedDocuments", () => {
  it("returns a corpus's documents with the previews that make hashes choosable", async () => {
    const controller = makeController();

    const result = await createCaller(
      contextWith(makeContainer(controller)),
    ).evaluation.stagedDocuments({ corpusId: "tender-2026" });

    expect(controller.listStagedDocuments).toHaveBeenCalledWith({ corpusId: "tender-2026" });
    expect(result[0]?.preview).toBe("Response of Acme");
  });

  it("surfaces an unstaged corpus as NOT_FOUND", async () => {
    const controller = makeController({
      listStagedDocuments: vi
        .fn()
        .mockResolvedValue(err(domainError("NOT_FOUND", "no corpus staged under ghost"))),
    });

    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.stagedDocuments({
        corpusId: "ghost",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("evaluation.create", () => {
  it("creates the evaluation and returns it for the screen to redirect on", async () => {
    const controller = makeController();

    const result = await createCaller(contextWith(makeContainer(controller))).evaluation.create(
      createInput,
    );

    expect(controller.createEvaluation).toHaveBeenCalledWith(createInput);
    expect(result.id).toBe("tender-2026");
    expect(result.stage).toBe("documents_uploaded");
  });

  it("admits a non-admin caller holding evaluation:create", async () => {
    const controller = makeController();
    const context = {
      ...contextWith(makeContainer(controller)),
      isAdmin: false,
      permissions: new Set<PermissionKey>(["evaluation:create"]),
    };

    await expect(createCaller(context).evaluation.create(createInput)).resolves.toBeDefined();
  });

  it("refuses a reviewer: opening a tender is not starting one", async () => {
    const controller = makeController();

    await expect(
      createCaller(reviewerContext(makeContainer(controller))).evaluation.create(createInput),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(controller.createEvaluation).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    const controller = makeController();
    const context = { ...contextWith(makeContainer(controller)), userId: null };

    await expect(createCaller(context).evaluation.create(createInput)).rejects.toThrow(
      /authentication required/i,
    );
    expect(controller.createEvaluation).not.toHaveBeenCalled();
  });

  it("maps a second evaluation over the same corpus to CONFLICT", async () => {
    const controller = makeController({
      createEvaluation: vi
        .fn()
        .mockResolvedValue(
          err(domainError("ALREADY_EXISTS", "an evaluation already exists over corpus tender-2026")),
        ),
    });

    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.create(createInput),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps a malformed shape off the wire rather than passing it to the domain", async () => {
    const controller = makeController();

    await expect(
      createCaller(contextWith(makeContainer(controller))).evaluation.create({
        ...createInput,
        documents: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(controller.createEvaluation).not.toHaveBeenCalled();
  });
});
