"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BranchOption {
  nodeId: string;
  nodeName: string;
}

interface BranchOverrideModalProps {
  open: boolean;
  branches: BranchOption[];
  onSelect: (targetNodeId: string) => void;
  onClose: () => void;
  isPending?: boolean;
}

export function BranchOverrideModal({
  open,
  branches,
  onSelect,
  onClose,
  isPending,
}: BranchOverrideModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleConfirm = () => {
    if (selected) onSelect(selected);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pick a step manually</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <p className="text-[13px] leading-[1.55] text-[#5a5650]">
            Wayfinder could not determine the next step automatically. Select which step to advance to.
          </p>
          <div className="flex flex-col gap-2">
            {branches.map((branch) => (
              <button
                key={branch.nodeId}
                type="button"
                onClick={() => setSelected(branch.nodeId)}
                className={`rounded-[10px] border-[1.5px] px-4 py-3 text-left text-[13px] transition-colors ${
                  selected === branch.nodeId
                    ? "border-[#3a5fd9] bg-[#eef1fc] text-[#1a1814]"
                    : "border-[#dedad2] text-[#5a5650] hover:bg-[#efede8]"
                }`}
              >
                {branch.nodeName}
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selected || isPending}>
            {isPending ? "Advancing…" : "Advance to step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
