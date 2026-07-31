import { describe, expect, it } from "vitest";
import {
  WorkflowController,
  buildContainer,
  buildColdStartClassifier,
  renderReviewGridView,
  renderPivotView,
  buildEvaluationWorkbook,
} from "@redline/redline-web";
import type { ProcurementResponse } from "@redline/redline-domain";
import { BuildEvaluationTable } from "@redline/redline-application";

// Item 3 step 1 (ADR-0019): prove the forked apps/web resolves redline's
// @redline/* workspaces before any mount code binds to them. This is the
// executable form of the step's exit — the tRPC router (step 2) and the
// container (step 3) both import exactly this surface, so if the workspace
// link regresses these bindings vanish and this fails at resolution time.
describe("redline workspace link", () => {
  it("resolves the @redline/redline-web mount surface the evaluation router binds to", () => {
    expect(WorkflowController).toBeTypeOf("function");
    expect(buildContainer).toBeTypeOf("function");
    expect(buildColdStartClassifier).toBeTypeOf("function");
    expect(renderReviewGridView).toBeTypeOf("function");
    expect(renderPivotView).toBeTypeOf("function");
    expect(buildEvaluationWorkbook).toBeTypeOf("function");
  });

  it("resolves the @redline/redline-application use-cases the container wires", () => {
    expect(BuildEvaluationTable).toBeTypeOf("function");
  });

  it("resolves @redline/redline-domain types (compile-time only)", () => {
    const response: ProcurementResponse | null = null;
    expect(response).toBeNull();
  });
});
