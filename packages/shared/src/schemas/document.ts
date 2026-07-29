import { z } from "zod";

// One repeating-group item: a flat record of sub-field key → value.
export const groupItemSchema = z.record(z.string());
export type GroupItem = z.infer<typeof groupItemSchema>;
export type GroupItems = GroupItem[];

// A field value is either a scalar string (placeholders, narrative, section
// Yes/No) or an array of records for a repeating group (ADR-032 §3).
export const documentDataSchema = z.record(z.union([z.string(), z.array(groupItemSchema)]));
export type DocumentData = z.infer<typeof documentDataSchema>;

export const documentSummarySchema = z.object({
  summary: z.string().describe("A 2-sentence summary of the generated document."),
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const templateStructureSchema = z.object({
  structuredContent: z
    .string()
    .describe(
      "The template reduced to its structural skeleton — headings, field labels and every {{tag}} placeholder preserved verbatim; long prose paragraphs that do not contain a tag or label are dropped.",
    ),
});
export type TemplateStructure = z.infer<typeof templateStructureSchema>;

// One field the AI proposes for an uploaded template. The model describes the
// field structurally and points at the text it belongs to; it never writes the
// annotation grammar itself — the caller serialises that from these parts, so a
// suggestion can never carry a syntax error into the document.
export const suggestedTemplateFieldSchema = z.object({
  label: z
    .string()
    .describe("Human-readable field name in Title Case, e.g. 'Supplier Name'. No annotations."),
  type: z
    .enum(["text", "date", "currency", "number", "email", "yesno", "narrative"])
    .describe("The kind of value this field captures."),
  optional: z.boolean().describe("True when the document still reads correctly if left blank."),
  options: z
    .array(z.string())
    .describe(
      "Allowed choices when the value is drawn from a fixed set, otherwise an empty array. Never include a comma inside a choice.",
    ),
  sourceText: z
    .string()
    .describe(
      "The exact text in the document this field replaces, copied character for character. For an empty template, the label text the placeholder should follow.",
    ),
  occurrence: z
    .number()
    .int()
    .min(0)
    .describe("Zero-based index of this sourceText among identical occurrences in the document."),
  context: z
    .string()
    .describe("The surrounding sentence or table row, so the author can place the field unseen."),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe("How certain you are this span is a variable rather than boilerplate."),
});
export type SuggestedTemplateFieldObject = z.infer<typeof suggestedTemplateFieldSchema>;

export const suggestedTemplateFieldsSchema = z.object({
  fields: z.array(suggestedTemplateFieldSchema),
});
export type SuggestedTemplateFields = z.infer<typeof suggestedTemplateFieldsSchema>;
