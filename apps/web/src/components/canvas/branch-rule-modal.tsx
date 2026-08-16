"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface BranchRuleTarget {
  edgeId: string;
  fromStepName: string;
  toStepName: string;
  rule: string;
}

// One field, because the whole point is that stating the condition should cost
// the author less than working around not having stated it. Opened by clicking
// the badge on a forked connector.
export function BranchRuleModal({
  target,
  onSave,
  onClose,
}: {
  target: BranchRuleTarget | null;
  onSave: (edgeId: string, rule: string | null) => void;
  onClose: () => void;
}) {
  const [rule, setRule] = useState("");

  // Re-seeded per edge rather than on every render: the field is uncontrolled by
  // the parent while open, so the author's typing is not overwritten by a
  // re-render triggered elsewhere on the canvas.
  useEffect(() => {
    setRule(target?.rule ?? "");
  }, [target?.edgeId, target?.rule]);

  const hasExistingRule = (target?.rule ?? "").trim().length > 0;

  return (
    <Dialog open={target !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>When should this branch be used?</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-[12px] leading-[1.55] text-[#736d5f]">
            This connector runs from <strong>{target?.fromStepName}</strong> to{" "}
            <strong>{target?.toStepName}</strong>. Describe the situation that should send the
            workflow down this path — the AI compares what happened in the conversation against
            this to decide which branch to take.
          </p>
          <Textarea
            value={rule}
            onChange={(event) => setRule(event.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="e.g. the total spend is £50,000 or more"
            aria-label="When should this branch be used?"
            data-testid="branch-rule-input"
          />
          <p className="text-[12px] leading-[1.55] text-[#736d5f]">
            Without a rule here, the AI falls back to guessing from the next step&apos;s own
            description — which says what that step does, not when to go there.
          </p>
        </DialogBody>
        <DialogFooter className="justify-between">
          {hasExistingRule ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => target && onSave(target.edgeId, null)}
            >
              Remove rule
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => target && onSave(target.edgeId, rule)}
              data-testid="branch-rule-save"
            >
              Save rule
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
