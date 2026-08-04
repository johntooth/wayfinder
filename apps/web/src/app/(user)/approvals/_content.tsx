"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DecisionModal } from "@/components/approvals/decision-modal";
import { isDecided } from "@/components/approvals/approval-outcome";
import {
  ApprovalSubject,
  ApproverStage,
  OutcomeChip,
  PreviousStep,
  type ApprovalContext,
} from "@/components/approvals/approval-parts";
import { trpc } from "@/trpc/client";

type Decision = "approved" | "rejected" | "changes_requested";
type Tab = "active" | "completed" | "all";

const TABS: { key: Tab; label: string; scope: "pending" | "decided" | "all" }[] = [
  { key: "active", label: "Active", scope: "pending" },
  { key: "completed", label: "Completed", scope: "decided" },
  { key: "all", label: "All", scope: "all" },
];

const EMPTY_COPY: Record<Tab, { heading: string; body: string }> = {
  active: {
    heading: "No approvals awaiting you",
    body: "Requests routed to you for sign-off will appear here.",
  },
  completed: {
    heading: "No decisions yet",
    body: "Once you approve, reject, or request changes, the decision is kept here.",
  },
  all: {
    heading: "Nothing here yet",
    body: "Requests routed to you, and the decisions you have made, both appear here.",
  },
};

// The full card, for a request that still needs deciding.
function ApprovalRow({
  approval,
  emailConfigured,
}: {
  approval: ApprovalContext;
  emailConfigured: boolean;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);

  return (
    <div
      data-approval-id={approval.approval.id}
      data-approval-status="pending"
      className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-[#dedad2] bg-white p-[16px_18px]"
    >
      <div className="flex items-center gap-[14px]">
        <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#fef3e2] text-[#a65b05]">
          <Stamp size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-[#1a1814]">{approval.chatName}</p>
          <p className="mt-[3px] truncate text-[12.5px] text-[#6d6a65]">
            {approval.originatorName ? <>From {approval.originatorName} · </> : null}
            Raised {new Date(approval.approval.createdAt).toLocaleString()} ·{" "}
            <Link href={`/chats/${approval.sessionId}`} className="font-medium text-[#3a5fd9]">
              Open session
            </Link>
          </p>
        </div>
      </div>

      <ApproverStage approval={approval} />

      <ApprovalSubject description={approval.subjectDescription} />

      <PreviousStep previousStep={approval.previousStep} canEdit />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setDecision("approved")}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDecision("changes_requested")}>
          Request changes
        </Button>
        <Button size="sm" variant="danger" onClick={() => setDecision("rejected")}>
          Reject
        </Button>
      </div>

      {decision && (
        <DecisionModal
          approval={approval}
          decision={decision}
          emailConfigured={emailConfigured}
          onClose={() => setDecision(null)}
        />
      )}
    </div>
  );
}

// A decided request, collapsed to one line. The detail lives on its own page:
// history is scanned far more often than it is read, and a list of expanded
// documents is unscannable.
function DecidedRow({ approval }: { approval: ApprovalContext }) {
  const decidedAt = approval.approval.decidedAt;

  return (
    <Link
      href={`/approvals/${approval.approval.id}`}
      data-approval-id={approval.approval.id}
      data-approval-status={approval.approval.status}
      className="flex items-center gap-3 rounded-[12px] border border-[#dedad2] bg-white px-4 py-3 hover:border-[#c9c4b9]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-[#1a1814]">{approval.chatName}</p>
        <p className="mt-[3px] truncate text-[12px] text-[#6d6a65]">
          {approval.approvalStepName}
          {decidedAt ? <> · {new Date(decidedAt).toLocaleString()}</> : null}
          {approval.decidedByName ? <> · by {approval.decidedByName}</> : null}
        </p>
      </div>
      <OutcomeChip approval={approval} />
      <ChevronRight className="h-4 w-4 shrink-0 text-[#6d6a65]" />
    </Link>
  );
}

export function ApprovalsContent() {
  const [tab, setTab] = useState<Tab>("active");
  const scope = TABS.find((entry) => entry.key === tab)!.scope;

  const approvalsQuery = trpc.approval.list.useQuery({ scope }, { refetchOnMount: "always" });
  const emailStatusQuery = trpc.approval.emailStatus.useQuery();
  const emailConfigured = emailStatusQuery.data?.configured ?? true;
  const approvals = approvalsQuery.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#dedad2] bg-white px-5">
        <h1 className="text-[16px] font-bold text-[#1a1814]">Approvals</h1>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-[#dedad2] px-5">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`px-3 py-[10px] text-[13px] font-medium transition-colors ${
              tab === key
                ? "border-b-2 border-[#3a5fd9] text-[#3a5fd9]"
                : "text-[#6d6a65] hover:text-[#5a5650]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="container py-6">
          {approvalsQuery.isPending ? (
            <p className="text-[13px] text-[#6d6a65]">Loading…</p>
          ) : approvals.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[#dedad2] bg-white p-8 text-center">
              <p className="text-[14px] font-semibold text-[#1a1814]">{EMPTY_COPY[tab].heading}</p>
              <p className="mt-1 text-[13px] text-[#6d6a65]">{EMPTY_COPY[tab].body}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {approvals.map((approval) =>
                // A decided row is history whichever tab it arrived on, so the
                // "All" tab shows each in its own right rather than flattening
                // both to one shape.
                isDecided(approval.approval.status) ? (
                  <DecidedRow key={approval.approval.id} approval={approval} />
                ) : (
                  <ApprovalRow
                    key={approval.approval.id}
                    approval={approval}
                    emailConfigured={emailConfigured}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
