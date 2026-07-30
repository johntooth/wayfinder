import {
  deriveFieldKey,
  ok,
  templateFieldToLine,
  type ILanguageModel,
  type Result,
  type TemplateField,
  type TemplateFieldType,
} from "@rbrasier/domain";
import { suggestedTemplateFieldsSchema, type SuggestedTemplateFieldObject } from "@rbrasier/shared";

// Which branch of the guided flow asked for suggestions. `augment` is the
// "find any I've missed" pass over a document that already carries tags.
export type SuggestionMode = "empty" | "filled" | "augment";

export interface SuggestTemplateFieldsInput {
  documentText: string;
  mode: SuggestionMode;
  existingLabels?: string[];
}

export interface SuggestedTemplateField {
  label: string;
  // The canonical `Label (annotations)` line, serialised here rather than by the
  // model so it always parses.
  line: string;
  type: TemplateFieldType;
  sourceText: string;
  occurrence: number;
  context: string;
  confidence: number;
  // True when `sourceText` is the caption that introduces the value rather than
  // the value itself, so the placeholder must be written after it. A caption is
  // the only thing telling the reader what a placeholder asks for — overwriting
  // it is never right.
  insertAfter: boolean;
}

export interface SuggestTemplateFieldsOutput {
  suggestions: SuggestedTemplateField[];
}

const MODE_BRIEF: Record<SuggestionMode, string> = {
  empty: [
    "This is a blank template: captions and headings with no content filled in.",
    "Propose a placeholder for each blank the document expects someone to fill.",
    "There is no value to point at yet, so for `sourceText` copy the caption the",
    "placeholder belongs to, exactly as it reads — for a line \"Supplier Name:\" use",
    "\"Supplier Name:\". The caption stays where it is and the placeholder is written",
    "after it, in the space where the answer goes.",
  ].join("\n"),
  filled: [
    "This is a filled-in example: a real past document. Decide which text is a",
    "variable that changes each time, and which is boilerplate that stays.",
    "Propose a field only for the variable spans.",
    "`sourceText` must be the answer, never the question. A form pairs a caption",
    "with the value someone entered: the caption names the field and stays in the",
    "document, and only the value is replaced by a placeholder. Word extracts one",
    "table cell per line, so a caption and its value read as consecutive lines —",
    "\"Employee Name\" then \"Richard Brasier\". There `label` is \"Employee Name\" and",
    "`sourceText` is \"Richard Brasier\". Pointing at the caption instead would erase",
    "the caption and leave the real value hard-coded in the template.",
    "Do not propose fields for headings, clause text, or standard terms.",
  ].join("\n"),
  augment: [
    "This document already has some placeholders. Propose only fields the author",
    "has missed — spans that clearly vary but carry no placeholder yet.",
    "For `sourceText`, copy the exact value being replaced. Never point at the",
    "caption that introduces a value — captions stay in the document.",
  ].join("\n"),
};

const buildPrompt = (input: SuggestTemplateFieldsInput): string => {
  const existing = input.existingLabels?.filter((label) => label.trim().length > 0) ?? [];
  const existingBlock =
    existing.length > 0
      ? `\nThe author already has these fields — do not propose them again:\n${existing
          .map((label) => `- ${label}`)
          .join("\n")}\n`
      : "";

  return [
    "You are helping a business user turn a document into a reusable template.",
    "",
    MODE_BRIEF[input.mode],
    existingBlock,
    "Rules:",
    "- `sourceText` must appear in the document below character for character.",
    "  A span you cannot copy exactly will be discarded.",
    "- `occurrence` is the zero-based index of that span among identical copies.",
    "- `label` is a short Title Case name. Never include brackets or annotations.",
    "- `label` and `sourceText` are different things: `label` names the field, while",
    "  `sourceText` is the document text the placeholder takes the place of. Unless",
    "  this is a blank template, they must not be the same text.",
    "- Use `options` when the value is drawn from a fixed set. A source value that is",
    "  itself a short comma- or slash-separated list of candidates (e.g. \"Mobile phone,",
    "  Laptop\") IS such a set — return each candidate as a separate option, and set",
    "  `multiple: true` when more than one could be chosen at once.",
    "- Use `narrative` only for a paragraph the AI should compose, not a value.",
    "- `confidence` is how sure you are the span varies rather than being boilerplate.",
    "- Propose nothing at all rather than guessing. An empty list is a valid answer.",
    "",
    "Document:",
    "---",
    input.documentText,
    "---",
  ].join("\n");
};

const countOccurrences = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return count;
    count += 1;
    from = index + needle.length;
  }
};

const positionOf = (haystack: string, needle: string, occurrence: number): number => {
  let index = -1;
  for (let seen = 0; seen <= occurrence; seen += 1) {
    index = haystack.indexOf(needle, index + (seen === 0 ? 0 : needle.length));
    if (index < 0) return -1;
  }
  return index;
};

// A value that runs longer than this is prose, not a form answer, so it is not
// worth guessing at when recovering the value a caption introduces.
const MAX_INFERRED_VALUE_CHARS = 120;

// The punctuation Word and Excel leave between a caption and its value:
// "Supplier Name: Acme Pty Ltd", "Supplier Name — Acme Pty Ltd".
const CAPTION_SEPARATOR = /^[\s:|\-–—]+/;

const lineBoundsAt = (text: string, index: number): { start: number; end: number } => {
  const end = text.indexOf("\n", index);
  return { start: text.lastIndexOf("\n", index) + 1, end: end < 0 ? text.length : end };
};

const occurrenceBefore = (text: string, needle: string, index: number): number =>
  countOccurrences(text.slice(0, index), needle);

const isUsableValue = (value: string, reservedKeys: Set<string>): boolean => {
  if (value.length > MAX_INFERRED_VALUE_CHARS) return false;
  if (value.includes("{{")) return false;
  // A trailing colon marks another caption, not somebody's answer.
  if (value.endsWith(":")) return false;
  return !reservedKeys.has(deriveFieldKey(value));
};

// Recovers the value a caption introduces, for when the model points at the
// caption despite being told not to. Word extracts each table cell as its own
// line, so the value is either the rest of the caption's line or the line
// straight after it. Returns null when neither yields something that reads like
// an answer — a blank in the example, or the next caption — and the caller then
// places the placeholder after the caption instead.
const valueIntroducedBy = (
  documentText: string,
  caption: string,
  captionIndex: number,
  reservedKeys: Set<string>,
): { sourceText: string; index: number } | null => {
  const captionLine = lineBoundsAt(documentText, captionIndex);

  const restFrom = captionIndex + caption.length;
  const rest = documentText.slice(restFrom, captionLine.end);
  const sameLineValue = rest.replace(CAPTION_SEPARATOR, "").trim();
  if (sameLineValue) {
    if (!isUsableValue(sameLineValue, reservedKeys)) return null;
    return { sourceText: sameLineValue, index: restFrom + rest.indexOf(sameLineValue) };
  }

  let lineStart = captionLine.end + 1;
  while (lineStart < documentText.length) {
    const { end } = lineBoundsAt(documentText, lineStart);
    const line = documentText.slice(lineStart, end);
    const value = line.trim();
    if (value) {
      if (!isUsableValue(value, reservedKeys)) return null;
      return { sourceText: value, index: lineStart + line.indexOf(value) };
    }
    lineStart = end + 1;
  }

  return null;
};

const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

interface AnchorInput {
  documentText: string;
  mode: SuggestionMode;
  sourceText: string;
  occurrence: number;
  position: number;
  fieldKey: string;
  reservedKeys: Set<string>;
}

interface ResolvedAnchor {
  sourceText: string;
  occurrence: number;
  position: number;
  insertAfter: boolean;
}

// Decides what the placeholder actually replaces. A `sourceText` that reads as
// the field's own caption is redirected onto the value that caption introduces,
// and where there is no such value the placeholder goes after the caption
// instead. Either way the caption survives, which is the whole point: a template
// whose captions have been eaten by placeholders cannot be filled in by anyone.
const resolveAnchor = (input: AnchorInput): ResolvedAnchor => {
  const base = {
    sourceText: input.sourceText,
    occurrence: input.occurrence,
    position: input.position,
  };
  if (deriveFieldKey(input.sourceText) !== input.fieldKey) {
    return { ...base, insertAfter: false };
  }

  // A blank template has no value yet, so its caption is the only anchor there is.
  if (input.mode === "empty") return { ...base, insertAfter: true };

  const value = valueIntroducedBy(
    input.documentText,
    input.sourceText,
    input.position,
    input.reservedKeys,
  );
  if (!value) return { ...base, insertAfter: true };

  return {
    sourceText: value.sourceText,
    occurrence: occurrenceBefore(input.documentText, value.sourceText, value.index),
    position: value.index,
    insertAfter: false,
  };
};

const toField = (suggestion: SuggestedTemplateFieldObject): TemplateField | null => {
  const label = suggestion.label.trim();
  if (!label) return null;

  const options = suggestion.options.map((option) => option.trim()).filter(Boolean);
  // A type and an options list are mutually exclusive in the grammar, so an
  // options-backed suggestion serialises as text carrying (options: …) — or
  // (multi-options: …) when more than one choice can apply at once.
  const type: TemplateFieldType = options.length > 0 ? "text" : suggestion.type;

  return {
    key: deriveFieldKey(label),
    label,
    type,
    optional: suggestion.optional,
    raw: "",
    ...(options.length > 0 ? { options } : {}),
    ...(options.length > 0 && suggestion.multiple ? { multiple: true } : {}),
  };
};

// Proposes template fields for an uploaded document. Two properties make the
// output safe to write into a document: the annotation line is serialised from
// the model's structured answer rather than written by the model, and every
// suggestion is anchored against the real document text before it is returned.
// A model failure yields no suggestions rather than an error — the guided flow
// falls back to the manual path, which is always available.
export class SuggestTemplateFields {
  constructor(private readonly languageModel: ILanguageModel) {}

  async execute(input: SuggestTemplateFieldsInput): Promise<Result<SuggestTemplateFieldsOutput>> {
    const aiResult = await this.languageModel.generateObject<{
      fields: SuggestedTemplateFieldObject[];
    }>({
      purpose: "template-field-suggestion",
      prompt: buildPrompt(input),
      schema: suggestedTemplateFieldsSchema,
      temperature: 0.1,
    });

    if (aiResult.error) return ok({ suggestions: [] });

    const existingKeys = new Set(
      (input.existingLabels ?? []).map((label) => deriveFieldKey(label)),
    );
    const proposed = aiResult.data.object.fields ?? [];
    // Every name in play, so redirecting a caption onto "the next line" can never
    // land on another field's caption.
    const reservedKeys = new Set([
      ...existingKeys,
      ...proposed.map((raw) => deriveFieldKey(raw.label ?? "")),
    ]);
    const anchored: Array<{ position: number; suggestion: SuggestedTemplateField }> = [];

    for (const raw of proposed) {
      const field = toField(raw);
      if (!field) continue;
      if (existingKeys.has(field.key)) continue;

      const occurrence = Number.isInteger(raw.occurrence) ? raw.occurrence : 0;
      if (occurrence < 0) continue;
      if (countOccurrences(input.documentText, raw.sourceText) <= occurrence) continue;

      const position = positionOf(input.documentText, raw.sourceText, occurrence);
      if (position < 0) continue;

      const anchor = resolveAnchor({
        documentText: input.documentText,
        mode: input.mode,
        sourceText: raw.sourceText,
        occurrence,
        position,
        fieldKey: field.key,
        reservedKeys,
      });

      anchored.push({
        position: anchor.position,
        suggestion: {
          label: field.label,
          line: templateFieldToLine(field),
          type: field.type,
          sourceText: anchor.sourceText,
          occurrence: anchor.occurrence,
          context: raw.context,
          confidence: clampConfidence(raw.confidence),
          insertAfter: anchor.insertAfter,
        },
      });
    }

    // Presented in the order they appear in the document (spec §3) so the author
    // reviews them against a reading of the page, not the model's output order.
    anchored.sort((a, b) => a.position - b.position);
    return ok({ suggestions: anchored.map((entry) => entry.suggestion) });
  }
}
