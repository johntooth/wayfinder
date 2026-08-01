"use client";

import Link from "next/link";
import { ReviewTable } from "@/components/evaluation/review-table";

// The review stage screen for an evaluation (ADR-0019, delivery-plan item 3
// step 3): the sortable, delineated grid of every procurement response, with the
// Excel export. The evaluation name feeds only the export filename; until the
// evaluation router surfaces it, the id stands in and evaluationExportFileName
// slugs it.
export function EvaluationReviewContent({ evaluationId }: { evaluationId: string }) {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-[16px] px-[20px] py-[24px]">
      <header className="flex flex-col gap-[4px]">
        <nav className="flex gap-[12px] text-[12px] text-[#3a5fd9]">
          <span className="font-semibold text-[#1a1814]">Review</span>
          <Link href={`/evaluations/${evaluationId}/pivots`} className="hover:underline">
            Pricing pivots
          </Link>
        </nav>
        <h1 className="text-[20px] font-bold text-[#1a1814]">Evaluation review</h1>
      </header>

      <ReviewTable evaluationId={evaluationId} evaluationName={evaluationId} />
    </div>
  );
}
