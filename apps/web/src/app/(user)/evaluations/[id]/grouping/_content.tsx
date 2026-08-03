"use client";

import Link from "next/link";

// The grouping stage landing for an evaluation (ADR-0019, delivery-plan item 3
// step 3). The interactive composition surface — drag documents into response
// groups, mark consortiums, advance the stage — is the WorkflowManager, whose
// write-side procedures land with the lens stage machine (delivery-plan §3), so
// this page routes into the read-side review and pricing surfaces that are
// already served. It is the mount point the stage machine grows into, not a
// fabricated mutation surface.
export function EvaluationGroupingContent({ evaluationId }: { evaluationId: string }) {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-[16px] px-[20px] py-[24px]">
      <header className="flex flex-col gap-[4px]">
        <nav className="flex gap-[12px] text-[12px] text-[#3a5fd9]">
          <span className="font-semibold text-[#1a1814]">Grouping</span>
          <Link href={`/evaluations/${evaluationId}/review`} className="hover:underline">
            Review
          </Link>
          <Link href={`/evaluations/${evaluationId}/pivots`} className="hover:underline">
            Pricing pivots
          </Link>
        </nav>
        <h1 className="text-[20px] font-bold text-[#1a1814]">Grouping</h1>
      </header>

      <p className="max-w-[640px] text-[13px] text-[#5a5650]">
        Documents are grouped by vendor before classification. Once an evaluation
        reaches the review stage, open the{" "}
        <Link href={`/evaluations/${evaluationId}/review`} className="text-[#3a5fd9] hover:underline">
          review grid
        </Link>{" "}
        to see each response delineated by topic and brand, or the{" "}
        <Link href={`/evaluations/${evaluationId}/pivots`} className="text-[#3a5fd9] hover:underline">
          pricing pivots
        </Link>{" "}
        for the vendor and requirement roll-ups.
      </p>
    </div>
  );
}
