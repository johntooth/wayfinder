import {
  deriveFieldKey,
  parseTemplateField,
  templateFieldToLine,
  type TemplateField,
  type TemplateFieldType,
} from "@rbrasier/domain";

// The field types a row editor can author. `select` / `multiselect` are the UI
// names for an options / multi-options field. `narrative` is document-only —
// prose the AI composes — so the structured editor omits it.
export type FieldRowType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "email"
  | "yesno"
  | "select"
  | "multiselect"
  | "narrative";

export interface FieldRowTypeOption {
  value: FieldRowType;
  label: string;
}

const BASE_TYPE_OPTIONS: FieldRowTypeOption[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "yesno", label: "Yes / No" },
  { value: "select", label: "Single-select" },
  { value: "multiselect", label: "Multi-select" },
];

// ADR-038 §5: a structured conversation has no document, so `narrative` (prose
// the AI writes into a document) has no meaning there.
export const STRUCTURED_TYPE_OPTIONS: FieldRowTypeOption[] = BASE_TYPE_OPTIONS;

export const TEMPLATE_TYPE_OPTIONS: FieldRowTypeOption[] = [
  ...BASE_TYPE_OPTIONS,
  { value: "narrative", label: "Narrative" },
];

export interface FieldModel {
  label: string;
  type: FieldRowType;
  optional: boolean;
  maxLength?: number;
  max?: number;
  min?: number;
  options: string[];
  instruction?: string;
}

export const emptyModel = (): FieldModel => ({
  label: "",
  type: "text",
  optional: false,
  options: [],
});

// Parses a stored `Label (annotations)` line into the editor model. A blank or
// unparseable line degrades to a plain text field carrying whatever text is
// there, so the row still renders and re-serialises cleanly on the next edit.
export const lineToModel = (line: string): FieldModel => {
  const stripped = line.trim().replace(/^\{\{/, "").replace(/\}\}$/, "").trim();
  if (!stripped) return emptyModel();

  const parsed = parseTemplateField(stripped);
  if (parsed.error) return { ...emptyModel(), label: stripped };

  const field = parsed.data;
  const type = fieldRowTypeOf(field);

  return {
    label: field.label,
    type,
    optional: field.optional,
    options: field.options ?? [],
    ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.instruction !== undefined ? { instruction: field.instruction } : {}),
  };
};

const fieldRowTypeOf = (field: TemplateField): FieldRowType => {
  if (field.options) return field.multiple ? "multiselect" : "select";
  switch (field.type) {
    case "number":
    case "currency":
    case "date":
    case "email":
    case "yesno":
    case "narrative":
      return field.type;
    default:
      return "text";
  }
};

// Serialises the model back to a canonical line via the domain serialiser. An
// empty label yields an empty line so the parent's parser skips it rather than
// flagging a "missing field name" error mid-typing.
export const modelToLine = (model: FieldModel): string => {
  if (!model.label.trim()) return "";

  const hasOptions = model.type === "select" || model.type === "multiselect";
  // Narrow to a TemplateFieldType: options-backed fields serialise as `text`
  // carrying an (options) / (multi-options) annotation.
  const scalarType: TemplateFieldType =
    model.type === "select" || model.type === "multiselect" ? "text" : model.type;

  const field: TemplateField = {
    key: deriveFieldKey(model.label),
    label: model.label.trim(),
    type: scalarType,
    optional: model.optional,
    raw: "",
    ...(hasOptions ? { options: model.options.filter((option) => option.trim().length > 0) } : {}),
    ...(model.type === "multiselect" ? { multiple: true } : {}),
    ...(model.maxLength !== undefined ? { maxLength: model.maxLength } : {}),
    ...(model.max !== undefined ? { max: model.max } : {}),
    ...(model.min !== undefined ? { min: model.min } : {}),
    ...(model.type === "narrative" && model.instruction ? { instruction: model.instruction } : {}),
  };

  return templateFieldToLine(field);
};

// Drives the accent colour on the row's config icon: true whenever the author
// has set anything the cog controls, so a configured field is visible without
// opening it. Field name and type are the row's own controls, not config.
export const hasNonDefaultConfig = (model: FieldModel): boolean =>
  model.optional ||
  model.maxLength !== undefined ||
  model.max !== undefined ||
  model.min !== undefined ||
  model.options.some((option) => option.trim().length > 0) ||
  (model.instruction?.trim().length ?? 0) > 0;

// Drops constraints that no longer apply when the author switches type, so a
// changed field never carries a stray (max) or (options) into the serialised line.
export const withType = (model: FieldModel, type: FieldRowType): FieldModel => ({
  label: model.label,
  type,
  optional: model.optional,
  options: type === "select" || type === "multiselect" ? model.options : [],
  ...(type === "narrative" && model.instruction ? { instruction: model.instruction } : {}),
});

export const linesToModels = (lines: string[]): FieldModel[] =>
  (lines.length > 0 ? lines : [""]).map(lineToModel);
