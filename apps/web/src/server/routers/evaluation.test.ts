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
    openReviewGrid?: ReturnType<typeof vi.fn>;
    openPricingPivot?: ReturnType<typeof vi.fn>;
    buildWorkbook?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  return {
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
