import { emptySchemaRequestFieldDraft } from "@rbrasier/domain";
import type { PendingSchemaRequest, SchemaRequestFieldDraft } from "@rbrasier/domain";

// The editor state behind the in-feed schema form, kept out of the component so
// it can be tested directly — the same split as `extraction-editor-model.ts`.

export const carriesOptions = (type: string): boolean => type === "select" || type === "multiselect";

const carriesBounds = (type: string): boolean => type === "number" || type === "currency";

// Seeds the editor from what the model proposed, always with at least one row so
// the form is never empty. Copies each row so editing never mutates the
// persisted request.
export const seedRows = (request: PendingSchemaRequest): SchemaRequestFieldDraft[] =>
  request.proposedFields.length > 0
    ? request.proposedFields.map((field) => ({ ...field }))
    : [emptySchemaRequestFieldDraft()];

// Drops configuration that no longer applies, so a switched row never submits a
// stray option list or bound.
export const applyTypeChange = (
  row: SchemaRequestFieldDraft,
  type: string,
): SchemaRequestFieldDraft => ({
  ...row,
  type,
  options: carriesOptions(type) ? row.options : [],
  min: carriesBounds(type) ? row.min : null,
  max: carriesBounds(type) ? row.max : null,
});

// Removing the last row leaves a blank one rather than an empty form the
// operator cannot type into.
export const withRowRemoved = (
  rows: SchemaRequestFieldDraft[],
  index: number,
): SchemaRequestFieldDraft[] => {
  const next = rows.filter((_, i) => i !== index);
  return next.length > 0 ? next : [emptySchemaRequestFieldDraft()];
};

// The comma-separated choices field. Blank entries are dropped here rather than
// left for the domain to strip, so the operator sees what will be submitted.
export const parseOptionsInput = (value: string): string[] =>
  value
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
