// Reads a document's append-only `editHistory` back into something a person can
// look at. The history has always been recorded (ADR-024) and has always been
// preserved across regeneration; nothing ever showed it, so an originator could
// see *that* an approver changed their document but never *what* they changed.

import type { DocumentEdit } from "./session-message";

// A field as it stands now, supplied by the caller so labels and formatting come
// from the live field set rather than being re-derived from the stored keys.
export interface DocumentEditSummaryField {
  key: string;
  label: string;
  type: string;
  value: string;
}

export interface DocumentEditSummaryChange {
  key: string;
  label: string;
  previousValue: string;
  newValue: string;
}

// One save, with the fields it changed. Deliberately not folded across saves:
// with two approvers in a chain, who changed a value matters as much as what it
// became, and a folded original-to-current diff loses the second name.
export interface DocumentEditSummaryEntry {
  editedAt: string;
  editedByUserId: string | null;
  changes: DocumentEditSummaryChange[];
}

export interface DocumentEditSummaryUntouchedField {
  key: string;
  label: string;
  value: string;
}

export interface DocumentEditSummary {
  edits: DocumentEditSummaryEntry[];
  untouched: DocumentEditSummaryUntouchedField[];
}

// A group's before/after is stored as JSON, because a list cannot be diffed as a
// string. Rendering it back is this module's job — the alternative is a modal
// that shows the originator a wall of braces.
const describeGroupValue = (raw: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!Array.isArray(parsed)) return raw;
  if (parsed.length === 0) return "No items";

  return parsed
    .map((item, index) => {
      if (typeof item !== "object" || item === null) return `${index + 1}. ${String(item)}`;
      const pairs = Object.entries(item as Record<string, unknown>)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join("; ");
      return `${index + 1}. ${pairs}`;
    })
    .join("\n");
};

const formatValue = (value: string, type: string | undefined): string =>
  type === "group" ? describeGroupValue(value) : value;

export const summariseDocumentEdits = (input: {
  editHistory: readonly DocumentEdit[];
  fields: readonly DocumentEditSummaryField[];
}): DocumentEditSummary => {
  const fieldByKey = new Map(input.fields.map((field) => [field.key, field]));

  // Sorted rather than trusted: the history is appended in order, but a record
  // read back from storage is not worth assuming order on when the whole point
  // is to show the sequence of changes.
  const ordered = [...input.editHistory].sort((first, second) =>
    first.editedAt.localeCompare(second.editedAt),
  );

  const edits: DocumentEditSummaryEntry[] = [];
  const changedKeys = new Set<string>();

  for (const historyEntry of ordered) {
    if (historyEntry.changes.length === 0) continue;
    const changes = historyEntry.changes.map((change) => {
      changedKeys.add(change.key);
      const field = fieldByKey.get(change.key);
      return {
        key: change.key,
        label: field?.label ?? change.key,
        previousValue: formatValue(change.previousValue, field?.type),
        newValue: formatValue(change.newValue, field?.type),
      };
    });
    edits.push({
      editedAt: historyEntry.editedAt,
      editedByUserId: historyEntry.editedByUserId,
      changes,
    });
  }

  const untouched = input.fields
    .filter((field) => !changedKeys.has(field.key))
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: formatValue(field.value, field.type),
    }));

  return { edits, untouched };
};
