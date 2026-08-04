export interface ParsedApprovalDecision {
  // The first line: what was decided.
  outcome: string;
  approverName: string | null;
  approverEmail: string | null;
  decidedAt: Date;
  // Everything after the attribution — the approver's comment and any routing
  // note. Empty when the decision carried neither.
  body: string;
}

// The attribution line `buildApprovalDecisionMessage` writes. Both the name and
// the parenthesised email are optional, because the record copies identity in at
// decision time and a deleted account can leave either missing (ADR-040 §5).
const ATTRIBUTION = /^Decided(?: by ([^(]+?)(?: \(([^)]+)\))?)? at (\S+)\.$/;

// Reads back what the domain wrote, so the feed can render a decision as the
// approver's own message — their name, their email, and the moment they decided
// shown on the reader's clock rather than the server's. Anything that is not a
// decision record returns null and renders verbatim, so an operator who happens
// to type "Approval granted" is never dressed up as an approver.
export const parseApprovalDecisionMessage = (
  content: string,
): ParsedApprovalDecision | null => {
  const [outcome, attribution, ...rest] = content.split("\n");
  if (!outcome || !attribution) return null;

  const match = ATTRIBUTION.exec(attribution.trim());
  if (!match) return null;

  const decidedAt = new Date(match[3]!);
  if (Number.isNaN(decidedAt.getTime())) return null;

  return {
    outcome: outcome.trim(),
    approverName: match[1]?.trim() ?? null,
    approverEmail: match[2]?.trim() ?? null,
    decidedAt,
    body: rest.join("\n").trim(),
  };
};

// Client-side by necessity: the server only knows UTC, and a decision time shown
// in the wrong timezone is worse than one not shown at all.
export const formatDecisionMoment = (decidedAt: Date): string => decidedAt.toLocaleString();
