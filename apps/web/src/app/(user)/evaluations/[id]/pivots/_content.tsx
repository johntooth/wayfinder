"use client";

import Link from "next/link";
import { PricingPivots } from "@/components/evaluation/pricing-pivots";

// The pricing pivots screen for an evaluation (ADR-0019, delivery-plan item 3
// step 3): the vendor / requirement / vendor × requirement roll-ups of the
// tender's costed responses.
export function EvaluationPivotsContent({ evaluationId }: { evaluationId: string }) {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-[16px] px-[20px] py-[24px]">
      <header className="flex flex-col gap-[4px]">
        <nav className="flex gap-[12px] text-[12px] text-[#3a5fd9]">
          <Link href={`/evaluations/${evaluationId}/review`} className="hover:underline">
            Review
          </Link>
          <span className="font-semibold text-[#1a1814]">Pricing pivots</span>
        </nav>
        <h1 className="text-[20px] font-bold text-[#1a1814]">Pricing pivots</h1>
      </header>

      <PricingPivots evaluationId={evaluationId} />
    </div>
  );
}
