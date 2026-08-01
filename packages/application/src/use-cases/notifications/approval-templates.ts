// Pure subject/body builders for the two approval triggers. Template literals
// only — no templating framework — so the application layer keeps its
// domain+shared-only import rule. Bodies stay minimal (names + link) to keep PII
// out of email.

import type { ApprovalStatus } from "@rbrasier/domain";
import type { EmailContent } from "./templates";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export interface ApprovalRequestedEmailInput {
  flowName: string;
  requesterName: string;
  instructions: string | null;
  approvalUrl: string;
}

export const buildApprovalRequestedEmail = (input: ApprovalRequestedEmailInput): EmailContent => {
  const instructionLine = input.instructions ? [input.instructions, ""] : [];
  return {
    subject: `Approval needed: '${input.flowName}'`,
    text: [
      `${input.requesterName} has requested your approval in the '${input.flowName}' flow.`,
      "",
      ...instructionLine,
      `Review and decide here: ${input.approvalUrl}`,
    ].join("\n"),
    html: [
      `<p>${escapeHtml(input.requesterName)} has requested your approval in the '${escapeHtml(input.flowName)}' flow.</p>`,
      ...(input.instructions ? [`<p>${escapeHtml(input.instructions)}</p>`] : []),
      `<p><a href="${escapeHtml(input.approvalUrl)}">Review and decide</a></p>`,
    ].join("\n"),
  };
};

// Exhaustive by type, not by comparison: adding an ApprovalStatus without a
// label here fails to compile, so no recorded outcome can reach an originator
// unnamed (ADR-045 §4).
const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "still awaiting a decision",
  approved: "approved",
  approved_with_edits: "approved with edits",
  rejected: "declined",
  changes_requested: "returned for revision",
};

// The originator-facing label depends on the routing outcome as well as the
// recorded status: a rejection that routed the session back reads as "returned
// for revision" rather than "declined", because the work is still live.
const outcomeLabel = (status: ApprovalStatus, routedBack: boolean | undefined): string =>
  status === "rejected" && routedBack ? STATUS_LABEL.changes_requested : STATUS_LABEL[status];

export interface ApprovalDecidedEmailInput {
  flowName: string;
  // The recorded status, so an approval its own approver edited says so.
  status: ApprovalStatus;
  routedBack?: boolean;
  comment: string | null;
  sessionUrl: string;
}

export const buildApprovalDecidedEmail = (input: ApprovalDecidedEmailInput): EmailContent => {
  const label = outcomeLabel(input.status, input.routedBack);
  const commentLine = input.comment ? [`Comment: ${input.comment}`, ""] : [];
  return {
    subject: `Your '${input.flowName}' approval was ${label}`,
    text: [
      `Your approval request in the '${input.flowName}' flow was ${label}.`,
      "",
      ...commentLine,
      `Open the session here: ${input.sessionUrl}`,
    ].join("\n"),
    html: [
      `<p>Your approval request in the '${escapeHtml(input.flowName)}' flow was ${escapeHtml(label)}.</p>`,
      ...(input.comment ? [`<p>Comment: ${escapeHtml(input.comment)}</p>`] : []),
      `<p><a href="${escapeHtml(input.sessionUrl)}">Open the session</a></p>`,
    ].join("\n"),
  };
};
