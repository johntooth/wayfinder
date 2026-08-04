import { describe, expect, it } from "vitest";
import { summariseDocumentEdits } from "./document-edit-summary";
import type { DocumentEdit } from "./session-message";

const edit = (
  editedAt: string,
  editedByUserId: string | null,
  changes: DocumentEdit["changes"],
): DocumentEdit => ({ editedAt, editedByUserId, storagePath: `doc-${editedAt}.docx`, changes });

const fields = [
  { key: "supplier", label: "Supplier", type: "text", value: "Northwind Ltd" },
  { key: "start_date", label: "Start date", type: "date", value: "03-03-2026" },
  { key: "budget", label: "Budget", type: "currency", value: "£12,000" },
];

describe("summariseDocumentEdits", () => {
  it("resolves each change against the field set", () => {
    const summary = summariseDocumentEdits({
      editHistory: [
        edit("2026-03-01T09:00:00.000Z", "user-1", [
          { key: "start_date", previousValue: "01-03-2026", newValue: "03-03-2026" },
        ]),
      ],
      fields,
    });

    expect(summary.edits).toEqual([
      {
        editedAt: "2026-03-01T09:00:00.000Z",
        editedByUserId: "user-1",
        changes: [
          {
            key: "start_date",
            label: "Start date",
            previousValue: "01-03-2026",
            newValue: "03-03-2026",
          },
        ],
      },
    ]);
  });

  // Attribution is the point with two approvers in a chain: folding the history
  // into one original-to-current diff would hide who changed what.
  it("keeps a field edited twice as two entries, oldest first", () => {
    const summary = summariseDocumentEdits({
      editHistory: [
        edit("2026-03-02T09:00:00.000Z", "user-2", [
          { key: "budget", previousValue: "£10,000", newValue: "£12,000" },
        ]),
        edit("2026-03-01T09:00:00.000Z", "user-1", [
          { key: "budget", previousValue: "£8,000", newValue: "£10,000" },
        ]),
      ],
      fields,
    });

    expect(summary.edits.map((entry) => entry.editedByUserId)).toEqual(["user-1", "user-2"]);
    expect(summary.edits[0]!.changes[0]!.newValue).toBe("£10,000");
    expect(summary.edits[1]!.changes[0]!.previousValue).toBe("£10,000");
  });

  it("falls back to the key as the label for a field no longer in the set", () => {
    const summary = summariseDocumentEdits({
      editHistory: [
        edit("2026-03-01T09:00:00.000Z", "user-1", [
          { key: "retired_field", previousValue: "old", newValue: "new" },
        ]),
      ],
      fields,
    });

    expect(summary.edits[0]!.changes[0]!.label).toBe("retired_field");
  });

  it("lists every field no edit touched, in field order, at its current value", () => {
    const summary = summariseDocumentEdits({
      editHistory: [
        edit("2026-03-01T09:00:00.000Z", "user-1", [
          { key: "start_date", previousValue: "01-03-2026", newValue: "03-03-2026" },
        ]),
      ],
      fields,
    });

    expect(summary.untouched).toEqual([
      { key: "supplier", label: "Supplier", value: "Northwind Ltd" },
      { key: "budget", label: "Budget", value: "£12,000" },
    ]);
  });

  it("treats every field as untouched when nothing has been edited", () => {
    const summary = summariseDocumentEdits({ editHistory: [], fields });

    expect(summary.edits).toEqual([]);
    expect(summary.untouched).toHaveLength(3);
  });

  it("drops an edit that changed nothing", () => {
    const summary = summariseDocumentEdits({
      editHistory: [edit("2026-03-01T09:00:00.000Z", "user-1", [])],
      fields,
    });

    expect(summary.edits).toEqual([]);
  });

  // A repeating group's before/after is stored as JSON (the only way to diff a
  // list), which is unreadable in a modal meant for the originator.
  it("renders a repeating group's stored JSON as readable item lines", () => {
    const summary = summariseDocumentEdits({
      editHistory: [
        edit("2026-03-01T09:00:00.000Z", "user-1", [
          {
            key: "items",
            previousValue: JSON.stringify([{ name: "Laptop", quantity: "10" }]),
            newValue: JSON.stringify([
              { name: "Laptop", quantity: "12" },
              { name: "Dock", quantity: "12" },
            ]),
          },
        ]),
      ],
      fields: [{ key: "items", label: "Items", type: "group", value: "" }],
    });

    const change = summary.edits[0]!.changes[0]!;
    expect(change.previousValue).toBe("1. name: Laptop; quantity: 10");
    expect(change.newValue).toBe("1. name: Laptop; quantity: 12\n2. name: Dock; quantity: 12");
  });

  it("shows an emptied group as no items rather than an empty string", () => {
    const summary = summariseDocumentEdits({
      editHistory: [
        edit("2026-03-01T09:00:00.000Z", "user-1", [
          { key: "items", previousValue: JSON.stringify([{ name: "Laptop" }]), newValue: "[]" },
        ]),
      ],
      fields: [{ key: "items", label: "Items", type: "group", value: "" }],
    });

    expect(summary.edits[0]!.changes[0]!.newValue).toBe("No items");
  });

  it("keeps an unparseable group value verbatim rather than losing it", () => {
    const summary = summariseDocumentEdits({
      editHistory: [
        edit("2026-03-01T09:00:00.000Z", "user-1", [
          { key: "items", previousValue: "not json", newValue: "[]" },
        ]),
      ],
      fields: [{ key: "items", label: "Items", type: "group", value: "" }],
    });

    expect(summary.edits[0]!.changes[0]!.previousValue).toBe("not json");
  });
});
