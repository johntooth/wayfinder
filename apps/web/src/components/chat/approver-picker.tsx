"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Info, Loader2, Mail, Stamp } from "lucide-react";
import { toast } from "sonner";
import type { ApproverSource } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";
import { approverStageLabel } from "./approver-label";
import { picksApproverManually, setupNotice, type SetupNotice } from "./approval-gate-state";

export interface ApproverPickerProps {
  sessionId: string;
  flowId: string;
  flowName: string;
  // The approval node the request is being raised against.
  nodeId: string;
  nodeName: string;
  approverSource: ApproverSource;
  instructions: string | null;
  roleHint: string | null;
  // Whether email can actually deliver the request; drives the manual fallback.
  emailConfigured: boolean;
  // Raised once the request has been sent, so a host that owns the surrounding
  // chrome (the decision modal) can close or refresh.
  onSent?: () => void;
}

interface ChosenApprover {
  userId: string | null;
  email: string;
  label: string;
}

// Choosing and confirming an approver, in one place. The chat gate and the
// decision modal both mount this rather than each growing their own: they ask
// the same question, and the modal's answer — who signs next — is what a chained
// approval needs to keep moving without bouncing back to the originator.
//
// ADR-018's guarantees are unchanged wherever it is mounted: the resolver only
// ever suggests, "Someone else" is always offered, and the suggestion and any
// override are both recorded.
export function ApproverPicker({
  sessionId,
  flowId,
  flowName,
  nodeId,
  nodeName,
  approverSource,
  instructions,
  roleHint,
  emailConfigured,
  onSent,
}: ApproverPickerProps) {
  const utils = trpc.useUtils();
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ChosenApprover | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus the approver search box when the operator reveals it (replaces
  // autoFocus, forbidden by jsx-a11y/no-autofocus). Gated on showSearch so it
  // fires only in response to the user toggling search open.
  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  const suggest = trpc.approval.suggest.useMutation({
    onSuccess: (data) => {
      setApprovalId(data.approval.id);
      if (data.approval.approverUserId || data.approval.approverEmail) {
        setSent(true);
        const email = data.approval.approverEmail ?? data.suggestedApprover?.email ?? null;
        setSentTo(email ?? data.suggestedApprover?.name ?? "the approver");
        setSentToEmail(email);
        return;
      }
      // With nothing to confirm, go straight to the choice the operator has to
      // make rather than parking them behind a "Someone else" button.
      setShowSearch(picksApproverManually(Boolean(data.suggestedApprover)));
      if (data.suggestedApprover) {
        setChosen({
          userId: data.suggestedApprover.userId,
          email: data.suggestedApprover.email,
          label: data.suggestedApprover.name ?? data.suggestedApprover.email,
        });
      }
    },
  });

  // Raise/load the pending request once for this node.
  const suggestMutate = suggest.mutate;
  useEffect(() => {
    suggestMutate({ sessionId, flowId, nodeId });
  }, [sessionId, flowId, nodeId, suggestMutate]);

  const searchQuery = trpc.people.search.useQuery(
    { query, limit: 8 },
    { enabled: showSearch && query.trim().length > 1 },
  );

  const suggestedUserId = suggest.data?.suggestedApprover?.userId ?? null;

  const confirmAndSend = trpc.approval.confirmAndSend.useMutation({
    onSuccess: async () => {
      setSent(true);
      setSentTo(chosen?.label ?? "the approver");
      setSentToEmail(chosen?.email ?? null);
      await utils.session.get.invalidate({ sessionId });
      toast.success(emailConfigured ? "Approval request sent" : "Approver confirmed");
      onSent?.();
    },
    onError: (error) => toast.error(error.message ?? "Could not record the request"),
  });

  const send = () => {
    if (!approvalId || !chosen) return;
    const isOverride = chosen.userId === null || chosen.userId !== suggestedUserId;
    confirmAndSend.mutate({
      approvalId,
      approverUserId: chosen.userId,
      approverEmail: chosen.userId ? null : chosen.email,
      isOverride,
    });
  };

  const approvalUrl = typeof window !== "undefined" ? `${window.location.origin}/approvals` : "/approvals";

  const buildMailtoHref = (email: string): string => {
    const subject = `Approval needed: '${flowName}'`;
    const body = [
      `You've been asked to approve a step in the '${flowName}' workflow.`,
      ...(instructions ? ["", instructions] : []),
      "",
      "Review and record your decision here:",
      approvalUrl,
    ].join("\n");
    return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const copyApprovalLink = async () => {
    try {
      await navigator.clipboard.writeText(approvalUrl);
      toast.success("Approval link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  // Sits to the right of the panel heading: an icon, a line, and the detail
  // only when asked for. What is not configured is worth saying once, quietly —
  // it is never the operator's task, and it must not read as an error.
  const noticeButton = (notice: SetupNotice) => (
    <button
      type="button"
      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-[#6d6a65] hover:bg-[#f3ede2] hover:text-[#1a1814]"
      aria-expanded={showNotice}
      onClick={() => setShowNotice((open) => !open)}
      data-approval-setup-notice
    >
      <Info className="h-3.5 w-3.5" />
      {notice.label}
    </button>
  );

  const noticeDetail = (notice: SetupNotice) =>
    showNotice && (
      <div className="space-y-2 rounded-[10px] border border-[#e8d4b0] bg-white px-3 py-2">
        {notice.paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-[12.5px] text-[#5a5650]">
            {paragraph}
          </p>
        ))}
      </div>
    );

  // Always rendered, never conditional on a roleHint: which signature this is —
  // first supervisor, second supervisor, or a policy-named role — is the first
  // thing both the operator and the approver need to know.
  const stageLine = (
    <p className="text-[13px] text-[#5a5650]" data-approver-stage>
      Approver: <span className="font-medium text-[#1a1814]">{approverStageLabel({ approverSource, roleHint })}</span>
      <span className="text-[#6d6a65]"> · {nodeName}</span>
    </p>
  );

  // Until the initial suggest resolves we cannot tell whether the request is
  // already sent or still needs an approver, so show a loading state rather than
  // flashing the empty confirm form (which makes a re-opened session feel as if
  // the approver must be re-entered).
  const requestResolved = suggest.isSuccess || suggest.isError;
  if (!requestResolved) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#6d6a65]">
        <Loader2 className="h-4 w-4 animate-spin text-[#a65b05]" />
        Loading approval…
      </div>
    );
  }

  if (sent) {
    const notice = setupNotice({ emailConfigured, hasSuggestion: true });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Stamp className="h-5 w-5 text-[#a65b05]" />
            <p className="text-[13px] text-[#92400e]">
              {emailConfigured ? (
                <>
                  Awaiting approval — sent to <span className="font-medium">{sentTo}</span>.
                </>
              ) : (
                <>
                  Awaiting approval from <span className="font-medium">{sentTo}</span>.
                </>
              )}
            </p>
          </div>
          {notice && noticeButton(notice)}
        </div>

        {stageLine}

        {notice && noticeDetail(notice)}

        {!emailConfigured && (
          <div className="flex flex-wrap gap-2">
            {sentToEmail && (
              <Button asChild size="sm">
                <a href={buildMailtoHref(sentToEmail)}>
                  <Mail className="h-4 w-4" />
                  Email approver
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={copyApprovalLink}>
              <Copy className="h-4 w-4" />
              Copy approval link
            </Button>
          </div>
        )}
      </div>
    );
  }

  const notice = setupNotice({ emailConfigured, hasSuggestion: chosen !== null });

  return (
    <div className="flex flex-col gap-3" data-approver-picker>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-[#a65b05]" />
          <p className="text-[14px] font-semibold text-[#1a1814]">
            {chosen ? "Confirm the approver" : "Choose the approver"}
          </p>
        </div>
        {notice && noticeButton(notice)}
      </div>

      {notice && noticeDetail(notice)}

      {/* The subject the approver will see and the record will lock, shown
          here first so the operator can catch a wrong one before it is sent. */}
      {suggest.data?.subject?.description && (
        <p className="text-[13px] text-[#1a1814]" data-approval-subject>
          <span className="font-semibold">You are requesting approval of:</span>{" "}
          {suggest.data.subject.description}
        </p>
      )}

      {instructions && <p className="text-[13px] text-[#5a5650]">{instructions}</p>}

      {stageLine}

      {chosen && (
        <div className="rounded-[10px] border border-[#e8d4b0] bg-white px-3 py-2">
          <p className="text-[13px] text-[#1a1814]">
            Suggested: <span className="font-medium">{chosen.label}</span>
            {chosen.email && chosen.label !== chosen.email && (
              <span className="text-[#6d6a65]"> ({chosen.email})</span>
            )}
          </p>
        </div>
      )}

      {showSearch && (
        <div className="space-y-2 rounded-[10px] border border-[#dedad2] bg-white p-3">
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Entra, HR, or type any email…"
          />
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {(searchQuery.data ?? []).map((person) => (
              <button
                key={`${person.source}:${person.email}`}
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-[#1a1814] hover:bg-[#f7f6f3]"
                onClick={() => {
                  setChosen({
                    userId: person.userId,
                    email: person.email,
                    label: person.displayName ?? person.email,
                  });
                  setShowSearch(false);
                }}
              >
                <span className="truncate">{person.displayName ?? person.email}</span>
                <span className="ml-2 shrink-0 text-[11px] uppercase text-[#6d6a65]">
                  {person.source}
                </span>
              </button>
            ))}
            {searchQuery.data?.length === 0 && query.trim().length > 1 && (
              <p className="px-2 py-1 text-[12px] text-[#6d6a65]">No matches.</p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={send} disabled={!chosen || confirmAndSend.isPending}>
          {emailConfigured ? "Confirm & send" : "Confirm"}
        </Button>
        {/* Only an offer to change a suggestion. With the picker already open
            there is nothing for it to do. */}
        {!showSearch && (
          <Button size="sm" variant="outline" onClick={() => setShowSearch(true)}>
            Someone else
          </Button>
        )}
      </div>
    </div>
  );
}
