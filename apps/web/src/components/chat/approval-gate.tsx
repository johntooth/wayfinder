"use client";

import type { ApproverSource } from "@rbrasier/domain";
import { trpc } from "@/trpc/client";
import { ApproverPicker } from "./approver-picker";

interface ApprovalGateProps {
  sessionId: string;
  flowId: string;
  flowName: string;
  nodeId: string;
  nodeName: string;
  approverSource: ApproverSource;
  instructions: string | null;
  // The policy-named approver role authored on the node, shown to the operator
  // so they know who the request is meant for before confirming.
  roleHint: string | null;
}

// Operator-facing gate shown when a session is parked on an approval node. The
// selection itself lives in `ApproverPicker`, shared with the decision modal in
// `/approvals`; this contributes only the chat panel's framing.
export function ApprovalGate({
  sessionId,
  flowId,
  flowName,
  nodeId,
  nodeName,
  approverSource,
  instructions,
  roleHint,
}: ApprovalGateProps) {
  // When email cannot be delivered the operator must notify the approver by hand,
  // so the confirm action only records the approver and surfaces manual options.
  const emailStatusQuery = trpc.approval.emailStatus.useQuery();
  const emailConfigured = emailStatusQuery.data?.configured ?? true;

  return (
    <div className="border-t border-[#dedad2] bg-[#fffaf2] px-5 py-4" data-approval-gate>
      <div className="mx-auto max-w-2xl">
        <ApproverPicker
          sessionId={sessionId}
          flowId={flowId}
          flowName={flowName}
          nodeId={nodeId}
          nodeName={nodeName}
          approverSource={approverSource}
          instructions={instructions}
          roleHint={roleHint}
          emailConfigured={emailConfigured}
        />
      </div>
    </div>
  );
}
