"use client";

import { CheckCircle2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmStepCardProps {
  stepName: string;
  onProceed: () => void;
  isPending?: boolean;
  // "override" frames the card as an explicit, audited override of a failed
  // automated pre-generation check, rather than a plain step hand-over.
  variant?: "confirm" | "override";
}

// Mirrors DocumentCard's visual language (bordered white card, same shadow) at a
// smaller size. Pinned to the chat footer while the step awaits operator
// confirmation; the composer stays enabled so the operator can keep chatting.
export function ConfirmStepCard({
  stepName,
  onProceed,
  isPending = false,
  variant = "confirm",
}: ConfirmStepCardProps) {
  const isOverride = variant === "override";
  return (
    <div className="flex shrink-0 justify-center border-t border-[#dedad2] bg-[#f7f6f3] px-4 py-3">
      <div className="flex w-full max-w-sm items-center gap-3 rounded-[10px] border border-[#dedad2] bg-white p-[10px_12px] shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] ${
            isOverride ? "bg-[#fdeede] text-[#b5701a]" : "bg-[#eaf6f0] text-[#1c7d45]"
          }`}
        >
          {isOverride ? (
            <ShieldAlert className="h-[18px] w-[18px] stroke-[1.8]" />
          ) : (
            <CheckCircle2 className="h-[18px] w-[18px] stroke-[1.8]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#1a1814]">
            {isOverride ? "Generate anyway?" : "Ready to continue?"}
          </p>
          <p className="mt-0.5 truncate text-[11px] leading-snug text-[#6d6a65]">
            {isOverride
              ? "The automated check flagged gaps. Generating is recorded in the audit log."
              : `${stepName} looks complete. Proceed when you're ready.`}
          </p>
        </div>
        <Button size="sm" onClick={onProceed} disabled={isPending} className="shrink-0">
          {isPending
            ? isOverride
              ? "Generating…"
              : "Proceeding…"
            : isOverride
              ? "Generate anyway"
              : "Proceed"}
        </Button>
      </div>
    </div>
  );
}
