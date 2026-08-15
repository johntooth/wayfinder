import {
  AUTHORABLE_STAGES,
  PIVOT_AXES,
  REVIEW_COLUMNS,
  renderDocumentView,
  renderPivotView,
  renderReviewGridView,
  type EvaluationWorkbook,
  type PivotMeasureKind,
  type PricingPivot,
  type ReviewColumnKey,
  type ReviewGrid,
  type RunStatusViewModel,
  type SortDirection,
} from "@redline/redline-web";
import type {
  AuthorableStage,
  DomainError,
  Evaluation,
  ExtractionElement,
  ProcurementResponse,
  Result,
  RunConfigOverrideInput,
  StagedCorpus,
  StagedDocument,
} from "@redline/redline-domain";
import type { CreateEvaluationInput } from "@redline/redline-application";
import { isErr } from "@redline/redline-domain";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { permissionProcedure, router } from "../trpc";

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
// The run half's two sub-controllers, reached through the same WorkflowController
// the read side uses (redline-web container.ts: corpus() drives staging + create
// + trigger, runStatus() polls and resumes). Declared here as the slice this
// router calls so it stays typed against the seam, not the concrete class.
interface RunTriggerController {
  createCorpus(input: {
    runName: string;
    uploads: readonly {
      fileName: string;
      bytes: Uint8Array;
      contentType: string;
    }[];
    stageSequence: readonly AuthorableStage[];
    configOverride?: RunConfigOverrideInput;
  }): Promise<Result<{ readonly corpusId: string; readonly runId: string }>>;
}

interface RunStatusPollController {
  poll(input: { runId: string }): Promise<Result<RunStatusViewModel>>;
  resume(input: { runId: string }): Promise<Result<{ readonly runId: string }>>;
}

interface EvaluationController {
  listEvaluations(): Promise<Result<readonly Evaluation[]>>;
  listStagedCorpora(): Promise<Result<readonly StagedCorpus[]>>;
  listStagedDocuments(input: { corpusId: string }): Promise<Result<readonly StagedDocument[]>>;
  createEvaluation(input: CreateEvaluationInput): Promise<Result<Evaluation>>;
  populate(input: {
    evaluationId: string;
  }): Promise<Result<readonly ProcurementResponse[]>>;
  openReviewGrid(input: { evaluationId: string }): Promise<Result<ReviewGrid>>;
  openPricingPivot(input: { evaluationId: string }): Promise<Result<PricingPivot>>;
  buildWorkbook(input: { evaluationId: string }): Promise<Result<EvaluationWorkbook>>;
  openDocument(input: {
    evaluationId: string;
    documentId: string;
  }): Promise<Result<readonly ExtractionElement[]>>;
  corpus(): RunTriggerController;
  runStatus(): RunStatusPollController;
}

// container.ts sets `redline` to null when REDLINE_* is unset, so this fork
// still boots as plain Wayfinder — "the evaluation router is the only surface
// that notices". Noticing means saying so: dereferencing the null instead would
// surface a configuration state as a TypeError, and the /evaluations index is
// reachable from the sidebar without an evaluation id, so it is the first thing
// that would hit it.
const controllerOf = (ctx: { container: unknown }): EvaluationController => {
  const redline = (ctx.container as {
    redline: { workflowController: EvaluationController } | null;
  }).redline;
  if (!redline) {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "The redline evaluation stack is not configured on this deployment.",
    });
  }
  return redline.workflowController;
};

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

// Every review-side procedure is gated on `evaluation:review` (ADR-0006, added
// on the redline fork branch): admins pass via the wildcard, Power Users hold it
// by default (seed-roles), and an unauthenticated caller is rejected upstream by
// authenticatedProcedure, which permissionProcedure composes.
const reviewProcedure = permissionProcedure("evaluation:review");

// Creating an evaluation is a write, and the review key's own description covers
// opening the grid, the pivots and the export — not bringing a tender into
// being. Split the same way the fork splits extraction:author from
// extraction:run, so a reviewer cannot start one.
const createProcedure = permissionProcedure("evaluation:create");

// An evaluationId is operator-authored — `redline_evaluations.id` is `text`, the
// domain type is `string`, and the corpus manifest lets the operator name it. A
// uuid() input rejected every such evaluation here, so it was created and then
// unreadable. Same reasoning as documentId below.
const evaluationIdInput = z.object({ evaluationId: z.string().min(1) });

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

// A documentId is a womblex source_hash, not a uuid, so it is validated as a
// non-blank string. `element` is a womblex elem_order — a non-negative integer.
const documentInput = evaluationIdInput.extend({
  documentId: z.string().min(1),
  element: z.number().int().nonnegative().optional(),
});

// A corpus id is the prefix an operator staged under, so it is a non-blank
// string and never a uuid — the same reasoning as evaluationId above. A brand is
// what the specialist types; a field is a name plus the prose an adjudicator
// reasons from. All of it is validated again in the domain, which owns the
// blank-name and unknown-document rules; this schema only keeps malformed shapes
// off the wire.
const createInput = z.object({
  corpusId: z.string().min(1),
  name: z.string().min(1),
  documents: z
    .array(z.object({ documentId: z.string().min(1), brand: z.string().min(1) }))
    .min(1),
  fields: z
    .array(z.object({ name: z.string().min(1), definition: z.string().min(1) }))
    .min(1),
});

// A run id is the sidecar's own handle, not a uuid the browser authors, so it is
// a non-blank string — the same reasoning as evaluationId above.
const runIdInput = z.object({ runId: z.string().min(1) });

// The four downstream passes a form may author, taken from redline-web's own
// allow-list so the wire never drifts from what the surface offers or the sidecar
// accepts. An off-list stage (`link`, `pii`, …) is refused here rather than below
// the seam.
const authorableStageEnum = z.enum(
  AUTHORABLE_STAGES as unknown as [AuthorableStage, ...AuthorableStage[]],
);

// The allow-listed config override a form authored (design-principles.md "a
// defined allow-list"). Every group is optional — an absent group means the field
// was left blank and the run inherits the redline.yaml default below the seam.
// The controller re-validates through makeRunConfigOverride before firing, so a
// malformed one (a non-positive chunk size, a non-ISO currency) is refused there;
// this schema only keeps a malformed shape off the wire.
const configOverrideInput = z
  .object({
    chunkMode: z
      .object({
        chunkingModel: z.string().nullable(),
        chunkSize: z.number(),
        chunkTables: z.boolean(),
      })
      .optional(),
    moneyVocabulary: z
      .object({
        extraHeaderTerms: z.array(z.string()),
        extraVetoTerms: z.array(z.string()),
        defaultCurrency: z.string(),
      })
      .optional(),
    extraction: z
      .object({
        ocrEngine: z.string(),
        ocrDpi: z.number(),
      })
      .optional(),
  })
  .optional() satisfies z.ZodType<RunConfigOverrideInput | undefined>;

// One document on its way to the run's input prefix. Base64 through tRPC into a
// Buffer, following the fork's own upload procedure
// (extraction.uploadDraftDocuments) rather than inventing a second transport.
// There is no treePath: these bytes land flat under proc/{run}/inputs/, which is
// the prefix womblex's runner lists.
const stagedFileSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string(),
});

// The stage sequence names at least one pass — the surface's trigger.enabled
// rule already refuses an empty one, and a run with no stage is not a run. The
// run name is passed through as typed (the controller trims it): a corpus is a
// womblex run and its id is the engine's to mint, not this router's to curate.
const createCorpusInput = z.object({
  runName: z.string().min(1),
  files: z.array(stagedFileSchema).min(1),
  stageSequence: z.array(authorableStageEnum).min(1),
  configOverride: configOverrideInput,
});

export const evaluationRouter = router({
  // The evaluations index (delivery-plan item 2): the way in for a specialist who
  // has neither the URL shape nor an evaluation id. Unlike its siblings this
  // returns the domain entities unshaped — an evaluation carries only a name and
  // a stage, so there is nothing for a view model to render that the screen
  // cannot bind to directly.
  list: reviewProcedure.query(async ({ ctx }) => {
    const evaluations = await controllerOf(ctx).listEvaluations();
    if (isErr(evaluations)) throw toTrpcError(evaluations.error);
    return evaluations.data;
  }),

  // What the create screen picks from: the corpora the sidecar's load path has
  // already staged. Gated on create, not review — it is the first step of
  // starting an evaluation, and it discloses which corpora exist.
  stagedCorpora: createProcedure.query(async ({ ctx }) => {
    const corpora = await controllerOf(ctx).listStagedCorpora();
    if (isErr(corpora)) throw toTrpcError(corpora.error);
    return corpora.data;
  }),

  // One corpus's documents, each with the opening passage that makes an opaque
  // womblex source_hash choosable.
  stagedDocuments: createProcedure
    .input(z.object({ corpusId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const documents = await controllerOf(ctx).listStagedDocuments({ corpusId: input.corpusId });
      if (isErr(documents)) throw toTrpcError(documents.error);
      return documents.data;
    }),

  // The router's first mutation, and the fork mount (redline delivery-plan
  // §2.1): composing an evaluation used to leave it with documents and no
  // responses, because WorkflowController.populate existed but nothing served
  // called it. Composition and population are still two calls, not one Result:
  // the reading passes (ingest, grouping, classify, build) can fail
  // independently of composition — a rejected adjudicator or an unreachable
  // chunk store is not "the evaluation was never created", and throwing here
  // would read as exactly that. The evaluation already exists and is reachable
  // at whatever stage the reading passes reached, so population failure is its
  // own state carried on the response, never a thrown error.
  create: createProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const controller = controllerOf(ctx);
    const created = await controller.createEvaluation(input);
    if (isErr(created)) throw toTrpcError(created.error);

    const populated = await controller.populate({ evaluationId: created.data.id });
    if (isErr(populated)) {
      return { ...created.data, populated: false, populationError: populated.error.message };
    }

    // BuildEvaluationTable is the pass that lands the evaluation at `review`;
    // populate() returns the built responses, not the evaluation, so the stage
    // is stated here rather than re-read from a controller call this router
    // does not otherwise need.
    return { ...created.data, stage: "review" as const, populated: true, populationError: null };
  }),

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

  // The document behind a review row's source deep-link. `element` is the cited
  // elem_order the link carries; it crosses the
  // wire so renderDocumentView resolves the anchor server-side, the same way the
  // grid's sort and filter do, rather than the client re-deriving it.
  document: reviewProcedure.input(documentInput).query(async ({ ctx, input }) => {
    const elements = await controllerOf(ctx).openDocument({
      evaluationId: input.evaluationId,
      documentId: input.documentId,
    });
    if (isErr(elements)) throw toTrpcError(elements.error);
    return renderDocumentView({
      evaluationId: input.evaluationId,
      documentId: input.documentId,
      elements: elements.data,
      anchorElementOrder: input.element,
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

  // The ingest half (fork mount): the Create Corpus tab hands over the run name,
  // the raw documents and the authored config, and gets back the corpus id and
  // the run id it then polls by. Staging and firing are one call because their
  // ordering is a rule, not a preference — the controller refuses a nameless or
  // empty run before staging anything and never fires over a half-staged prefix,
  // which a React sequence of two mutations could not guarantee.
  //
  // No evaluation is created here. womblex mints each document's source_hash on
  // extract, so brands and fields cannot be named until the run has drained;
  // /evaluations/new composes the evaluation over the finished corpus. Gated on
  // create because starting a run is starting an evaluation.
  createCorpus: createProcedure.input(createCorpusInput).mutation(async ({ ctx, input }) => {
    const created = await controllerOf(ctx)
      .corpus()
      .createCorpus({
        runName: input.runName,
        uploads: input.files.map((file) => ({
          fileName: file.filename,
          bytes: new Uint8Array(Buffer.from(file.contentBase64, "base64")),
          contentType: file.mimeType,
        })),
        stageSequence: input.stageSequence,
        ...(input.configOverride ? { configOverride: input.configOverride } : {}),
      });
    if (isErr(created)) throw toTrpcError(created.error);
    return created.data;
  }),

  // Poll a run into the four-state view model the tab renders — started, errored
  // (which stage, why), resumable, done. A seam error (an unknown run, an
  // unreachable sidecar) surfaces as a tRPC error the tab shows, never a stuck
  // spinner; renderRunStatusView owns shouldKeepPolling below the seam.
  runStatus: createProcedure.input(runIdInput).query(async ({ ctx, input }) => {
    const status = await controllerOf(ctx).runStatus().poll({ runId: input.runId });
    if (isErr(status)) throw toTrpcError(status.error);
    return status.data;
  }),

  // Re-fire a failed run. Not a new run: the engine's idempotent enqueue and
  // skip-on-output mean re-firing picks up where it stopped, so this is the
  // resumable state's only action.
  resumeRun: createProcedure.input(runIdInput).mutation(async ({ ctx, input }) => {
    const resumed = await controllerOf(ctx).runStatus().resume({ runId: input.runId });
    if (isErr(resumed)) throw toTrpcError(resumed.error);
    return resumed.data;
  }),
});
