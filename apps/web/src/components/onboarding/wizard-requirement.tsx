"use client";

import { Check } from "lucide-react";

// Marks a step-2 card as required-but-unset or done. The wizard renders this
// above each card rather than inside it, so the settings page keeps showing the
// same cards without an onboarding-only badge.
export function WizardRequirement({
  label,
  satisfied,
  testId,
}: {
  label: string;
  satisfied: boolean;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      data-satisfied={satisfied ? "true" : "false"}
      className="flex items-center gap-2 text-xs font-medium"
    >
      {satisfied ? (
        <>
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1f8a4c] text-white">
            <Check className="h-3 w-3" />
          </span>
          <span className="text-[#1f8a4c]">{label} configured</span>
        </>
      ) : (
        <>
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[#b8532a] text-[10px] text-[#b8532a]">
            !
          </span>
          <span className="text-[#b8532a]">{label} required</span>
        </>
      )}
    </div>
  );
}
