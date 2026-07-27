"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Shown when an admin skips the required step-2 configuration. Wayfinder cannot
// run a session without object storage and an AI provider, so leaving setup at
// this point has to be an explicit, informed choice.
export function WizardSkipDialog({
  open,
  onOpenChange,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="wizard-skip-warning-title">Leave setup unfinished?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription>
            You can configure these settings at any time from Configuration. Until object storage
            and an AI provider are set up, Wayfinder will not be functional — uploads and AI steps
            will fail.
          </DialogDescription>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={confirming}>
            Go back
          </Button>
          <Button
            variant="outline"
            data-testid="wizard-skip-confirm"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? "Exiting…" : "Exit setup anyway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
