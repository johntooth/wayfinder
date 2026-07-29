import {
  deriveFieldKey,
  parseTemplateField,
  validateAnnotationLine,
  type AnnotationWarning,
} from "@rbrasier/domain";
import type { AnnotationRow } from "@/lib/template-annotation";

// The guided flow's steps. Each processing step shows a loading indicator before
// the surface that follows it.
export type AnnotationStep =
  | "analysing"
  | "branch"
  | "suggesting"
  | "review"
  | "saving"
  | "cheatsheet";

// What the document turned out to be. `header` is an .xlsx that already works in
// ADR-039 header mode and therefore skips the guided flow entirely.
export type TemplateClassification = "annotated" | "empty" | "filled" | "header";

export type BranchAction = "continue" | "augment" | "suggest" | "cheatsheet";

export interface BranchOffer {
  title: string;
  body: string;
  primary: BranchAction;
  primaryLabel: string;
  secondary: BranchAction;
  secondaryLabel: string;
  requiresConfirmation: boolean;
  confirmationBody: string;
}

// Matches ConfidenceBar's bands: 80+ high, 50+ medium, below 50 low.
const LOW_CONFIDENCE_THRESHOLD = 50;

export interface EditableRow extends AnnotationRow {
  id: string;
  // Explicit acknowledgement of a low-confidence AI suggestion. Save stays
  // disabled until every low-confidence row carries one.
  confirmed: boolean;
}

export const toEditableRows = (rows: AnnotationRow[]): EditableRow[] =>
  rows.map((row, index) => ({ ...row, id: `${row.key}-${index}`, confirmed: false }));

export const branchFor = (classification: Exclude<TemplateClassification, "header">): BranchOffer => {
  if (classification === "annotated") {
    return {
      title: "Placeholders found",
      body: "This document already has fields marked up. You can review them as they are, or let the AI look for any you have missed.",
      primary: "continue",
      primaryLabel: "Continue with these",
      secondary: "augment",
      secondaryLabel: "Let AI find any I've missed",
      requiresConfirmation: false,
      confirmationBody: "",
    };
  }

  if (classification === "empty") {
    return {
      title: "No placeholders yet",
      body: "This looks like a blank template. The AI can mark up the fields for you, or you can add them yourself in Word.",
      primary: "suggest",
      primaryLabel: "Add fields with AI",
      secondary: "cheatsheet",
      secondaryLabel: "I'll do it myself in Word",
      requiresConfirmation: false,
      confirmationBody: "",
    };
  }

  return {
    title: "This looks like a completed document",
    body: "The AI can use it as a pattern — working out which text changes each time and turning those parts into fields.",
    primary: "suggest",
    primaryLabel: "Use this as a pattern",
    secondary: "cheatsheet",
    secondaryLabel: "I'll do it myself in Word",
    requiresConfirmation: true,
    // The destructive-sounding part stated concretely, so the author knows the
    // document is being used as a pattern rather than as content.
    confirmationBody:
      "The details in this document — names, amounts, dates — will be replaced with fields. Your original file is not changed, and it is not saved as the template.",
  };
};

export interface RowValidation {
  blocking: string[];
  warnings: AnnotationWarning[];
}

const EMPTY_VALIDATION: RowValidation = { blocking: [], warnings: [] };

export const validateRow = (row: EditableRow): RowValidation => {
  // A section or group row carries a raw open tag, not a Label (annotations)
  // line. It rides through the annotator untouched, so validating it as a field
  // would flag a construct the author cannot edit here.
  if (row.locked) return EMPTY_VALIDATION;
  return validateAnnotationLine(row.line);
};

export const isLowConfidence = (row: EditableRow): boolean =>
  row.confidence !== null && row.confidence < LOW_CONFIDENCE_THRESHOLD;

const labelKeyOf = (row: EditableRow): string | null => {
  const line = row.line.trim();
  if (!line) return null;
  const parsed = parseTemplateField(line);
  return parsed.error ? null : deriveFieldKey(parsed.data.label);
};

// How many places in the document each field name fills. Counts a row's own
// repeated occurrences as well as separate rows sharing a name — both mean the
// author is asked once and several places are filled.
export const duplicateCounts = (rows: EditableRow[]): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (row.locked) continue;
    const key = labelKeyOf(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + Math.max(1, row.occurrences.length));
  }

  for (const [key, count] of counts) {
    if (count < 2) counts.delete(key);
  }

  return counts;
};

const activeRows = (rows: EditableRow[]): EditableRow[] =>
  rows.filter((row) => !row.locked && row.line.trim().length > 0);

// A cleared suggestion is a rejection, not an error — it simply never becomes a
// placeholder, so it is excluded from every save gate.
const isCleared = (row: EditableRow): boolean =>
  row.kind === "span" && row.line.trim().length === 0;

export const saveBlockedReason = (rows: EditableRow[]): string | null => {
  const considered = rows.filter((row) => !isCleared(row));

  if (considered.some((row) => validateRow(row).blocking.length > 0)) {
    return "Fix the highlighted fields before saving.";
  }

  if (activeRows(rows).length === 0) {
    return "Add at least one field before saving.";
  }

  if (considered.some((row) => isLowConfidence(row) && !row.confirmed)) {
    return "Confirm the fields the AI was unsure about before saving.";
  }

  return null;
};

export const canSave = (rows: EditableRow[]): boolean => saveBlockedReason(rows) === null;
