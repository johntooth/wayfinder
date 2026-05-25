"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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

interface ShareFlowDialogProps {
  open: boolean;
  flowId: string;
  flowName: string;
  onClose: () => void;
}

export function ShareFlowDialog({ open, flowId, flowName, onClose }: ShareFlowDialogProps) {
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/chats?flow=${flowId}&start=1`
      : "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share &ldquo;{flowName}&rdquo;</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <p className="text-[13px] leading-[1.55] text-[#5a5650]">
            Send this link to anyone with access to start a new chat using this flow.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={url}
              className="flex h-10 flex-1 rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 text-[13px] text-[#1a1814]"
            />
            <Button type="button" variant="outline" onClick={handleCopy}>
              {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
