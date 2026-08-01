import {
  PIVOT_AXES,
  REVIEW_COLUMNS,
  renderPivotView,
  renderReviewGridView,
  type EvaluationWorkbook,
  type PivotMeasureKind,
  type PricingPivot,
  type ReviewColumnKey,
  type ReviewGrid,
  type SortDirection,
} from "@redline/redline-web";
import type { DomainError, Result } from "@redline/redline-domain";
import { isErr } from "@redline/redline-domain";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";

// The redline evaluation-review surface (delivery-plan item 3), served by the
// forked Wayfinder over redline's WorkflowController. Every procedure is
// read-side: it reads the persisted ProcurementResponse[] (built by redline's
// BuildEvaluationTable) through the controller and returns the framework-free
// view model the /evaluations screens bind to — the same renderReviewGridView /
// renderPivotView the redline shell and its Playwright e2e pin.

// The slice of the controller this router drives. Declared here so the router
// stays typed before `container-redline.ts` wires the concrete
// WorkflowController onto ctx.container.redline; that module replaces this cast
// with a real container field.
interface EvaluationController {
  openReviewGrid(input: { evaluationId: string }): Promise<Result<ReviewGrid>>;
  openPricingPivot(input: { evaluationId: string }): Promise<Result<PricingPivot>>;
  buildWorkbook(input: { evaluationId: string }): Promise<Result<EvaluationWorkbook>>;
}

const controllerOf = (ctx: { container: unknown }): EvaluationController =>
  (ctx.container as { redline: { workflowController: EvaluationController } }).redline
    .workflowController;

// redline's DomainError taxonomy is wider than the fork's (it carries
// EXTRACTION_FAILED / CLASSIFICATION_FAILED / NOT_IMPLEMENTED), so map it here
// rather than reusing the fork's toTrpcError. The redline errors are surfaced
// unchanged elsewhere; this router only needs the read-side subset.
const redlineCodeMap: Record<DomainError["code"], TRPCError["code"]> = {
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "CONFLICT",
  VALIDATION_FAILED: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  EXTRACTION_FAILED: "INTERNAL_SERVER_ERROR",
  CLASSIFICATION_FAILED: "INTERNAL_SERVER_ERROR",
  INFRA_FAILURE: "INTERNAL_SERVER_ERROR",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
};

const toTrpcError = (error: DomainError): TRPCError =>
  new TRPCError({ code: redlineCodeMap[error.code], message: error.message, cause: error.cause });

// Authentication is the gate today; the `evaluation:review` permission replaces
// it once the fork branch adds that permission key to Better Auth.
const reviewProcedure = authenticatedProcedure;

const evaluationIdInput = z.object({ evaluationId: z.string().uuid() });

const measureInput = z.enum(["sum", "avg"]) satisfies z.ZodType<PivotMeasureKind>;

// The sortable column keys, taken from the view model's own column set so the
// router never drifts from what renderReviewGridView renders. Only sortable
// columns are accepted; renderReviewGridView ignores a non-sortable key anyway.
const columnKeyEnum = z.enum(
  REVIEW_COLUMNS.map((column) => column.key) as [ReviewColumnKey, ...ReviewColumnKey[]],
);
const directionInput = z.enum(["asc", "desc"]) satisfies z.ZodType<SortDirection>;

// Sort and filter cross the wire so the tested renderReviewGridView does the
// shaping server-side (delivery-plan item 3: "render the built view models",
// no client-side re-implementation of the sort/filter logic).
const reviewGridInput = evaluationIdInput.extend({
  sort: z.object({ key: columnKeyEnum, direction: directionInput }).optional(),
  filter: z
    .object({ query: z.string().optional(), requirementId: z.string().optional() })
    .optional(),
});

export const evaluationRouter = router({
  // The sortable/filterable review table for an evaluation at the review stage.
  reviewGrid: reviewProcedure.input(reviewGridInput).query(async ({ ctx, input }) => {
    const grid = await controllerOf(ctx).openReviewGrid({ evaluationId: input.evaluationId });
    if (isErr(grid)) throw toTrpcError(grid.error);
    return renderReviewGridView({
      evaluationId: input.evaluationId,
      grid: grid.data,
      sort: input.sort,
      filter: input.filter,
    });
  }),

  // A single pricing pivot (per vendor, per requirement, or the cross-tab),
  // summed or averaged over the same built responses the review grid reads.
  pricingPivot: reviewProcedure
    .input(evaluationIdInput.extend({ axis: z.enum(PIVOT_AXES), measure: measureInput }))
    .query(async ({ ctx, input }) => {
      const pivot = await controllerOf(ctx).openPricingPivot({ evaluationId: input.evaluationId });
      if (isErr(pivot)) throw toTrpcError(pivot.error);
      return renderPivotView({
        axis: input.axis,
        measure: input.measure,
        result: pivot.data.compute({ axis: input.axis, measure: input.measure }),
      });
    }),

  // The Excel export workbook (one review sheet plus one sheet per pivot). The
  // client hands this to redline's exportEvaluationXlsx to trigger the download,
  // so the write side stays out of the server.
  workbook: reviewProcedure.input(evaluationIdInput).query(async ({ ctx, input }) => {
    const workbook = await controllerOf(ctx).buildWorkbook({ evaluationId: input.evaluationId });
    if (isErr(workbook)) throw toTrpcError(workbook.error);
    return workbook.data;
  }),
});
