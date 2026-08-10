"use client";

import Link from "next/link";
import type { IntakeStage } from "@redline/redline-domain";
import { trpc } from "@/trpc/client";

// The evaluations index surface (delivery-plan item 2): every evaluation the
// store holds, newest first, each linking into its review grid. It binds
// straight to the `evaluation.list` procedure — an evaluation carries only a
// name and a stage, so unlike the review grid there is no view model between the
// entity and the screen.

const STAGE_LABELS: Record<IntakeStage, string> = {
  documents_uploaded: "Documents uploaded",
  grouping: "Grouping",
  classifying: "Classifying",
  review: "Review",
  finalised: "Finalised",
};

// Before the review stage a review grid has no built responses to show, so the
// row lands on the stage the evaluation is actually at.
const stageHref = (evaluationId: string, stage: IntakeStage): string =>
  stage === "review" || stage === "finalised"
    ? `/evaluations/${evaluationId}/review`
    : `/evaluations/${evaluationId}/grouping`;

function StageBadge({ stage }: { stage: IntakeStage }) {
  return (
    <span className="rounded-[5px] bg-[#eef1fc] px-[7px] py-[2px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#3a5fd9]">
      {STAGE_LABELS[stage]}
    </span>
  );
}

export function EvaluationsIndexContent({ canCreate }: { canCreate: boolean }) {
  const evaluationsQuery = trpc.evaluation.list.useQuery();

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-[16px] px-[20px] py-[24px]">
      <header className="flex items-start justify-between gap-[12px]">
        <div className="flex flex-col gap-[4px]">
          <h1 className="text-[20px] font-bold text-[#1a1814]">Evaluations</h1>
          <p className="max-w-[640px] text-[13px] text-[#5a5650]">
            Every procurement evaluation, most recent first. Open one to see each
            response delineated by topic and brand.
          </p>
        </div>
        {canCreate && (
          <Link
            href="/evaluations/new"
            data-testid="new-evaluation"
            className="shrink-0 rounded-[6px] bg-[#3a5fd9] px-[12px] py-[7px] text-[13px] font-medium text-white"
          >
            New evaluation
          </Link>
        )}
      </header>

      {evaluationsQuery.isPending && (
        <p className="text-[13px] text-[#6d6a65]">Loading evaluations…</p>
      )}

      {evaluationsQuery.isError && (
        <p className="text-[13px] text-[#b4413c]" role="alert">
          {evaluationsQuery.error.message}
        </p>
      )}

      {evaluationsQuery.data?.length === 0 && (
        <p className="text-[13px] text-[#6d6a65]" data-testid="evaluations-empty">
          No evaluations yet. Start one over a staged corpus to see its responses
          delineated here.
        </p>
      )}

      {evaluationsQuery.data && evaluationsQuery.data.length > 0 && (
        <ul className="flex flex-col gap-[8px]" data-testid="evaluations-list">
          {evaluationsQuery.data.map((evaluation) => (
            <li key={evaluation.id}>
              <Link
                href={stageHref(evaluation.id, evaluation.stage)}
                data-testid="evaluation-link"
                className="flex items-center justify-between gap-[12px] rounded-[8px] border border-[#dedad2] bg-white px-[14px] py-[11px] transition-colors hover:border-[#c5d0f7] hover:bg-[#f7f8fd]"
              >
                <span className="flex min-w-0 flex-col gap-[2px]">
                  <span className="truncate text-[14px] font-medium text-[#1a1814]">
                    {evaluation.name}
                  </span>
                  <span className="truncate text-[11px] text-[#6d6a65]">{evaluation.id}</span>
                </span>
                <StageBadge stage={evaluation.stage} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
