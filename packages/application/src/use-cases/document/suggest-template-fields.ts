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
}

export interface SuggestTemplateFieldsOutput {
  suggestions: SuggestedTemplateField[];
}

const MODE_BRIEF: Record<SuggestionMode, string> = {
  empty: [
    "This is a blank template: headings and labels with no content filled in.",
    "Propose a placeholder for each blank the document expects someone to fill.",
    "For `sourceText`, give the label text the placeholder should follow, copied",
    "exactly — e.g. for a line reading \"Supplier Name:\" use \"Supplier Name:\".",
  ].join("\n"),
  filled: [
    "This is a filled-in example: a real past document. Decide which text is a",
    "variable that changes each time, and which is boilerplate that stays.",
    "Propose a field only for the variable spans. For `sourceText`, copy the exact",
    "value being replaced — e.g. \"Acme Pty Ltd\", not the sentence around it.",
    "Do not propose fields for headings, clause text, or standard terms.",
  ].join("\n"),
  augment: [
    "This document already has some placeholders. Propose only fields the author",
    "has missed — spans that clearly vary but carry no placeholder yet.",
    "For `sourceText`, copy the exact text being replaced.",
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

const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
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
    const anchored: Array<{ position: number; suggestion: SuggestedTemplateField }> = [];

    for (const raw of aiResult.data.object.fields ?? []) {
      const field = toField(raw);
      if (!field) continue;
      if (existingKeys.has(field.key)) continue;

      const occurrence = Number.isInteger(raw.occurrence) ? raw.occurrence : 0;
      if (occurrence < 0) continue;
      if (countOccurrences(input.documentText, raw.sourceText) <= occurrence) continue;

      const position = positionOf(input.documentText, raw.sourceText, occurrence);
      if (position < 0) continue;

      anchored.push({
        position,
        suggestion: {
          label: field.label,
          line: templateFieldToLine(field),
          type: field.type,
          sourceText: raw.sourceText,
          occurrence,
          context: raw.context,
          confidence: clampConfidence(raw.confidence),
        },
      });
    }

    // Presented in the order they appear in the document (spec §3) so the author
    // reviews them against a reading of the page, not the model's output order.
    anchored.sort((a, b) => a.position - b.position);
    return ok({ suggestions: anchored.map((entry) => entry.suggestion) });
  }
}
