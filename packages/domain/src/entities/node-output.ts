import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import type { ConversationalNodeConfig } from "./flow-node";
import type { TemplateField } from "./template-field";

// The three author-facing output types for a conversational step (ADR-038).
// `unstructured` is the current name for the legacy stored `conversation_only`
// value; `structured` captures author-declared fields with no document.
export type OutputType = "generate_document" | "structured" | "unstructured";

// An output-type value as it may appear in stored config: the three current
// types plus the legacy `conversation_only` string written before ADR-038.
export type StoredOutputType = OutputType | "conversation_only";

// Maps a stored output-type value to a current OutputType. Legacy
// `conversation_only` (and any unrecognised or missing value) becomes
// `unstructured`, so a pre-ADR-038 node behaves exactly as an unstructured
// conversation with no data movement.
export const normaliseOutputType = (value: string | null | undefined): OutputType => {
  if (value === "generate_document") return "generate_document";
  if (value === "structured") return "structured";
  return "unstructured";
};

// The single field-set accessor feeding extraction and the pre-generation gate.
// A template step reads its parsed `documentTemplateFields`; a structured step
// reads its author-declared `structuredFields`; anything else has no field set.
// Being the sole reader keeps the two config slots from diverging (ADR-038 §2).
//
// A `signature` field is filtered out here rather than at each call site,
// because every consumer must inherit the exclusion: the AI prompt never learns
// the field exists, an unsigned slot never blocks readiness, and manual editing
// cannot reach it (ADR-043 §2). A signature slot the conversation can reach is a
// signature an operator can forge.
export const nodeFieldSet = (config: ConversationalNodeConfig): TemplateField[] => {
  const outputType = normaliseOutputType(config.outputType);
  if (outputType === "generate_document") return gatherable(config.documentTemplateFields);
  if (outputType === "structured") return gatherable(config.structuredFields);
  return [];
};

const gatherable = (fields: TemplateField[] | null | undefined): TemplateField[] =>
  (fields ?? []).filter((field) => field.type !== "signature");

// Validates an author-declared structured field set. The `section` type is a
// document "include/omit this part" concept with no meaning when no document
// exists, so it is rejected here — client and server share this check
// (ADR-038 §5). A `signature` is rejected for the same reason: no document, no
// signature (ADR-043 §2). Returns the fields unchanged on success.
export const validateStructuredFieldSet = (fields: TemplateField[]): Result<TemplateField[]> => {
  const section = fields.find((field) => field.type === "section");
  if (section) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${section.label}" uses the section type, which is only available for document templates. Remove it from this structured step.`,
      ),
    );
  }
  const signature = fields.find((field) => field.type === "signature");
  if (signature) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${signature.label}" is an approval signature, which is only available for document templates. Remove it from this structured step.`,
      ),
    );
  }
  return ok(fields);
};
