// Pure state for the approver gate: when the picker opens by itself, and what
// the panel's small "info" affordance says. Kept out of the component so both
// can be asserted without rendering.

export interface SetupNotice {
  // Accessible name of the icon button, and the heading of the explanation.
  readonly label: string;
  // The explanation itself, one paragraph per thing that is not configured.
  readonly paragraphs: readonly string[];
}

// No suggestion is what an unconfigured directory looks like from the
// operator's seat, and their next move is the same either way: pick someone.
// So the picker opens itself rather than making them ask for it.
export const picksApproverManually = (hasSuggestion: boolean): boolean => !hasSuggestion;

const NO_SUGGESTION =
  "Wayfinder suggests an approver from your reporting line, which an administrator loads from your HR data. Without it — or when the line does not name one person — you choose the approver yourself. Everything after that is unchanged.";

const NO_EMAIL =
  "Sending email is not set up, so Wayfinder records who is approving and gives you a link to pass on yourself. The approver still records their decision in Wayfinder, and the audit record is the same.";

// Absent when nothing needs explaining — the panel then carries no notice at
// all, rather than a reassuring one nobody needs to read.
export const setupNotice = (input: {
  emailConfigured: boolean;
  hasSuggestion: boolean;
}): SetupNotice | null => {
  const paragraphs = [
    ...(input.hasSuggestion ? [] : [NO_SUGGESTION]),
    ...(input.emailConfigured ? [] : [NO_EMAIL]),
  ];
  if (paragraphs.length === 0) return null;
  return {
    label: input.hasSuggestion ? "How this request is sent" : "Why you are choosing the approver",
    paragraphs,
  };
};
