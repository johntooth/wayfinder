"use client";

import { Check } from "lucide-react";
import {
  isRequirementSatisfied,
  REQUIREMENT_HINT,
  type RequirementState,
} from "./wizard-requirements";

// Marks a step-2 card as still required or done. The wizard renders this above
// each card rather than inside it, so the settings page keeps showing the same
// cards without an onboarding-only badge.
export function WizardRequirement({
  label,
  state,
  testId,
}: {
  label: string;
  state: RequirementState;
  testId: string;
}) {
  const satisfied = isRequirementSatisfied(state);

  return (
    <div
      data-testid={testId}
      data-state={state}
      data-satisfied={satisfied ? "true" : "false"}
      className="flex items-center gap-2 text-xs font-medium"
    >
      {satisfied ? (
        <>
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1f6b4d] text-white">
            <Check className="h-3 w-3" />
          </span>
          <span className="text-[#1f6b4d]">
            {label} {REQUIREMENT_HINT[state]}
          </span>
        </>
      ) : (
        <>
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[#b8532a] text-[10px] text-[#b8532a]">
            !
          </span>
          <span className="text-[#b8532a]">
            {label} {REQUIREMENT_HINT[state]}
          </span>
        </>
      )}
    </div>
  );
}
