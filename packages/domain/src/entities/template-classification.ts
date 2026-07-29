// How an uploaded document should be treated by the guided annotation flow.
// `annotated` already carries {{ tags }}; `empty` is a structure with no content;
// `filled` is a real past document whose values are a pattern, not content.
export type TemplateSourceKind = "annotated" | "empty" | "filled";

// A run of dots, underscores or dashes an author typed as a fill-in rule.
const FILL_RULE = /[._-]{3,}/;

// Minimum words before a line reads as a sentence rather than a caption.
const PROSE_WORD_COUNT = 8;

// A shorter line still reads as prose when it carries figures and terminates
// like a sentence — "Invoice 44821 was issued on 3 June 2025." is content.
const NUMERIC_PROSE_WORD_COUNT = 5;

const wordCount = (line: string): number => line.split(/\s+/).filter(Boolean).length;

// A label is the author's placeholder for content that was never filled in:
// a caption ending in a colon, or a fill-in rule waiting to be written on.
const isLabelLine = (line: string): boolean => line.endsWith(":") || FILL_RULE.test(line);

const isProseLine = (line: string): boolean => {
  const words = wordCount(line);
  if (words >= PROSE_WORD_COUNT) return true;
  return words >= NUMERIC_PROSE_WORD_COUNT && /\d/.test(line) && /[.!?]$/.test(line);
};

// Decides which branch of the guided flow an upload takes (spec §2). Tags win
// outright — a document the author has already annotated is never re-classified.
// Otherwise the split between prose lines and structural lines (labels, fill-in
// rules, headings) decides it.
//
// Ties resolve to `filled` deliberately: that path requires the author to
// confirm their values will be replaced, so a wrong guess is caught by a human,
// whereas a filled document mistaken for an empty one would have placeholders
// inserted around live content.
export const classifyTemplateSource = (text: string, tagCount: number): TemplateSourceKind => {
  if (tagCount > 0) return "annotated";

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let proseLines = 0;
  let structuralLines = 0;

  for (const line of lines) {
    if (isLabelLine(line)) {
      structuralLines += 1;
      continue;
    }
    if (isProseLine(line)) {
      proseLines += 1;
      continue;
    }
    structuralLines += 1;
  }

  if (proseLines === 0) return "empty";
  return proseLines >= structuralLines ? "filled" : "empty";
};
