import { deriveFieldKey, parseTemplateField, type TemplateAnnotationEdit } from "@rbrasier/domain";
import type { SuggestedTemplateField } from "@rbrasier/application";

// Where a row's text lives in the document. A `tag` row is an existing
// {{ placeholder }} being re-annotated; a `span` row is literal text (a filled
// example's value, or a label in an empty template) being turned into one.
export type AnnotationRowKind = "tag" | "span";

export interface AnnotationOccurrence {
  // The exact text to find, as it reads in the extracted document text.
  sourceText: string;
  occurrence: number;
}

export interface AnnotationRow {
  key: string;
  kind: AnnotationRowKind;
  // The canonical `Label (annotations)` line, without braces.
  line: string;
  occurrences: AnnotationOccurrence[];
  context: string;
  // The value being replaced, on the filled-example path. This is the author's
  // primary check that the inference caught the right span.
  originalValue: string | null;
  // 0–100 for an AI suggestion, null for a tag the author wrote themselves.
  confidence: number | null;
  // Section and group tags are multi-line Word constructs that cannot be
  // meaningfully edited in a flat grid. They ride through untouched.
  locked: boolean;
}

const TAG_PATTERN = /\{\{([\s\S]*?)\}\}/g;

const MAX_CONTEXT_CHARS = 200;

// Section close tags ({{/name}}) carry no field of their own — they dedupe
// against their open tag — so they never become a row.
const isCloseTag = (inner: string): boolean => inner.trimStart().startsWith("/");

const isSectionOrGroup = (inner: string): boolean => /^[#/^]/.test(inner.trim());

// Builds the editable row set from a document that already carries placeholders.
// Repeated uses of one field collapse into a single row carrying every
// occurrence, so the author answers once and all of its places are rewritten.
export const rowsFromDocumentTags = (documentText: string): AnnotationRow[] => {
  const rows = new Map<string, AnnotationRow>();
  const literalCounts = new Map<string, number>();

  for (const match of documentText.matchAll(TAG_PATTERN)) {
    const literal = match[0];
    const inner = (match[1] ?? "").trim();

    const seen = literalCounts.get(literal) ?? 0;
    literalCounts.set(literal, seen + 1);

    if (isCloseTag(inner)) continue;

    const locked = isSectionOrGroup(inner);
    const parsed = parseTemplateField(inner);
    // A malformed tag still becomes a row — the author needs to see it to fix
    // it, and hiding it would leave the document silently broken.
    const key = parsed.error ? `raw:${inner}` : deriveFieldKey(parsed.data.label);

    const existing = rows.get(key);
    if (existing) {
      existing.occurrences.push({ sourceText: literal, occurrence: seen });
      continue;
    }

    rows.set(key, {
      key,
      kind: "tag",
      line: inner,
      occurrences: [{ sourceText: literal, occurrence: seen }],
      context: contextFor(documentText, literal, seen),
      originalValue: null,
      confidence: null,
      locked,
    });
  }

  return [...rows.values()];
};

// Builds rows from an AI pass. Each suggestion stays its own row: two spans the
// model mapped to the same name are still two distinct places in the document,
// and merging them would hide one from review.
export const rowsFromSuggestions = (suggestions: SuggestedTemplateField[]): AnnotationRow[] =>
  suggestions.map((suggestion) => ({
    key: `${deriveFieldKey(suggestion.label)}:${suggestion.occurrence}`,
    kind: "span" as const,
    line: suggestion.line,
    occurrences: [{ sourceText: suggestion.sourceText, occurrence: suggestion.occurrence }],
    context: suggestion.context,
    originalValue: suggestion.sourceText,
    confidence: suggestion.confidence,
    locked: false,
  }));

// Turns the reviewed rows into the substitutions the document generator applies.
export const buildAnnotationEdits = (rows: AnnotationRow[]): TemplateAnnotationEdit[] => {
  const edits: TemplateAnnotationEdit[] = [];

  for (const row of rows) {
    if (row.locked) continue;

    const line = row.line.trim();
    // Clearing a row means different things by kind: an existing placeholder is
    // deleted from the document, whereas a suggestion the author rejected simply
    // never happens — the example's own text stays as it was.
    if (!line && row.kind === "span") continue;
    const replacement = line ? `{{ ${line} }}` : "";

    for (const occurrence of row.occurrences) {
      if (occurrence.sourceText === replacement) continue;
      edits.push({
        find: occurrence.sourceText,
        occurrence: occurrence.occurrence,
        replacement,
      });
    }
  }

  return edits;
};

// The line the span sits on, so the author can place a field in a document they
// cannot see. Long lines are windowed around the span rather than truncated from
// the start, which would cut off the very text being described.
export const contextFor = (
  documentText: string,
  sourceText: string,
  occurrence: number,
): string => {
  if (!sourceText) return "";

  let index = -1;
  for (let seen = 0; seen <= occurrence; seen += 1) {
    index = documentText.indexOf(sourceText, index < 0 ? 0 : index + sourceText.length);
    if (index < 0) return "";
  }

  const lineStart = documentText.lastIndexOf("\n", index) + 1;
  const lineEndIndex = documentText.indexOf("\n", index);
  const lineEnd = lineEndIndex < 0 ? documentText.length : lineEndIndex;
  const line = documentText.slice(lineStart, lineEnd).trim();
  if (line.length <= MAX_CONTEXT_CHARS) return line;

  const offsetInLine = index - lineStart;
  // Two characters of the budget belong to the leading and trailing ellipses.
  const window = Math.floor((MAX_CONTEXT_CHARS - sourceText.length - 2) / 2);
  const from = Math.max(0, offsetInLine - window);
  const to = Math.min(line.length, offsetInLine + sourceText.length + window);
  return `${from > 0 ? "…" : ""}${line.slice(from, to).trim()}${to < line.length ? "…" : ""}`;
};
