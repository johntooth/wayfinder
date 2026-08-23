import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import { deriveFieldKey } from "./template-field";

// The field types an AI-requested report schema may use — the extraction
// authoring vocabulary (ADR-033), not the Word-template one. `section`, `group`
// and `signature` are deliberately absent: they are template structures a report
// schema cannot produce, and the v2.9.0 structured conversation work already
// rejects `section` on both client and server.
export type SchemaRequestFieldType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "email"
  | "yesno"
  | "select"
  | "multiselect";

export const SCHEMA_REQUEST_FIELD_TYPES: readonly SchemaRequestFieldType[] = [
  "text",
  "number",
  "currency",
  "date",
  "email",
  "yesno",
  "select",
  "multiselect",
];

// Named separately from "anything else unknown" so the operator (and the model,
// on the next turn) is told *why* these three are refused rather than being
// shown a generic unknown-type message.
const TEMPLATE_ONLY_FIELD_TYPES = ["section", "group", "signature"];

const OPTION_TYPES: readonly SchemaRequestFieldType[] = ["select", "multiselect"];
const BOUNDED_TYPES: readonly SchemaRequestFieldType[] = ["number", "currency"];

const isSchemaRequestFieldType = (value: string): value is SchemaRequestFieldType =>
  (SCHEMA_REQUEST_FIELD_TYPES as readonly string[]).includes(value);

// A row as the operator's form holds it: the type is still a plain string
// because it may have come from the model's tool arguments, which are untrusted.
export interface SchemaRequestFieldDraft {
  label: string;
  type: string;
  required: boolean;
  options: string[];
  min: number | null;
  max: number | null;
  instruction: string;
}

// A validated field in a submitted schema.
export interface SchemaRequestField {
  key: string;
  label: string;
  type: SchemaRequestFieldType;
  required: boolean;
  options: string[];
  min: number | null;
  max: number | null;
  instruction: string;
}

export type SchemaRequestStatus = "pending" | "submitted" | "dismissed";

// What the model asked for, persisted against the message that suspended the
// turn (D2). Carrying the status here — rather than inferring it from the
// presence of `fields` — keeps a dismissed request distinguishable from one that
// was never answered, which is what stops the thread going dead.
export interface PendingSchemaRequest {
  toolName: string;
  // Why the model needs the schema, shown as the card's body copy.
  prompt: string;
  // The model's starting rows, for the operator to correct.
  proposedFields: SchemaRequestFieldDraft[];
  status: SchemaRequestStatus;
  fields?: SchemaRequestField[];
  resolvedAt?: string;
  resolvedByUserId?: string | null;
}

export const emptySchemaRequestFieldDraft = (): SchemaRequestFieldDraft => ({
  label: "",
  type: "text",
  required: true,
  options: [],
  min: null,
  max: null,
  instruction: "",
});

const buildField = (fieldDraft: SchemaRequestFieldDraft): Result<SchemaRequestField> => {
  const label = fieldDraft.label.trim();
  if (label.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Every field needs a name before the schema can be submitted."));
  }

  const type = fieldDraft.type.trim();
  if (TEMPLATE_ONLY_FIELD_TYPES.includes(type)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${label}" uses the ${type} field type, which belongs to a document template and cannot appear in a report schema.`,
      ),
    );
  }
  if (!isSchemaRequestFieldType(type)) {
    return err(
      domainError("VALIDATION_FAILED", `"${label}" uses an unknown field type "${type}".`),
    );
  }

  const carriesOptions = OPTION_TYPES.includes(type);
  const options = carriesOptions ? fieldDraft.options.map((o) => o.trim()).filter((o) => o.length > 0) : [];
  if (carriesOptions && options.length === 0) {
    return err(domainError("VALIDATION_FAILED", `"${label}" needs at least one choice to pick from.`));
  }

  const carriesBounds = BOUNDED_TYPES.includes(type);
  const min = carriesBounds ? fieldDraft.min : null;
  const max = carriesBounds ? fieldDraft.max : null;
  if (min !== null && max !== null && min > max) {
    return err(domainError("VALIDATION_FAILED", `"${label}" has a minimum above its maximum.`));
  }

  return ok({
    key: deriveFieldKey(label),
    label,
    type,
    required: fieldDraft.required,
    options,
    min,
    max,
    instruction: fieldDraft.instruction.trim(),
  });
};

export const parseSchemaRequestSubmission = (
  drafts: SchemaRequestFieldDraft[],
): Result<SchemaRequestField[]> => {
  if (drafts.length === 0) {
    return err(domainError("VALIDATION_FAILED", "A report schema needs at least one field."));
  }

  const fields: SchemaRequestField[] = [];
  const seenKeys = new Set<string>();
  for (const fieldDraft of drafts) {
    const built = buildField(fieldDraft);
    if (built.error) return built;

    if (seenKeys.has(built.data.key)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Two fields resolve to the duplicate key "${built.data.key}". Give each field a distinct name.`,
        ),
      );
    }
    seenKeys.add(built.data.key);
    fields.push(built.data);
  }

  return ok(fields);
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

// Seeds the form from the model's tool call. The arguments are untrusted, so an
// unknown or template-only type degrades to text rather than erroring — the
// operator corrects the row, and refusing here would leave them with no form at
// all. Always yields at least one row so the card is never empty.
export const proposedFieldsFromToolArguments = (toolArguments: string): SchemaRequestFieldDraft[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolArguments);
  } catch {
    return [emptySchemaRequestFieldDraft()];
  }

  const rawFields = (parsed as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    return [emptySchemaRequestFieldDraft()];
  }

  return rawFields.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const type = asString(row["type"]);
    const options = Array.isArray(row["options"]) ? row["options"].map(asString) : [];
    return {
      label: asString(row["label"]),
      type: isSchemaRequestFieldType(type) ? type : "text",
      required: row["required"] !== false,
      options: options.filter((option) => option.length > 0),
      min: typeof row["min"] === "number" ? row["min"] : null,
      max: typeof row["max"] === "number" ? row["max"] : null,
      instruction: asString(row["instruction"]),
    };
  });
};
