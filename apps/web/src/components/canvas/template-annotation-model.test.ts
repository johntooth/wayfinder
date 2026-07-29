import { describe, it, expect } from "vitest";
import {
  branchFor,
  canSave,
  duplicateCounts,
  isLowConfidence,
  saveBlockedReason,
  toEditableRows,
  validateRow,
  type EditableRow,
} from "./template-annotation-model";

const row = (overrides: Partial<EditableRow> = {}): EditableRow => ({
  id: "row-1",
  key: "supplier_name",
  kind: "tag",
  line: "Supplier Name (text)",
  occurrences: [{ sourceText: "{{ Supplier Name }}", occurrence: 0 }],
  context: "Supplier: {{ Supplier Name }}",
  originalValue: null,
  confidence: null,
  locked: false,
  confirmed: false,
  ...overrides,
});

describe("branchFor", () => {
  it("offers continue-or-augment when the document already has placeholders", () => {
    const branch = branchFor("annotated");
    expect(branch.primary).toBe("continue");
    expect(branch.secondary).toBe("augment");
    expect(branch.requiresConfirmation).toBe(false);
  });

  it("offers AI or Word for an empty template", () => {
    const branch = branchFor("empty");
    expect(branch.primary).toBe("suggest");
    expect(branch.secondary).toBe("cheatsheet");
    expect(branch.requiresConfirmation).toBe(false);
  });

  it("demands explicit confirmation for a filled example", () => {
    const branch = branchFor("filled");
    expect(branch.primary).toBe("suggest");
    expect(branch.requiresConfirmation).toBe(true);
  });

  it("names the destructive consequence concretely for a filled example", () => {
    expect(branchFor("filled").confirmationBody).toContain("replaced");
  });
});

describe("validateRow", () => {
  it("passes a well-formed row", () => {
    expect(validateRow(row()).blocking).toEqual([]);
  });

  it("blocks an unknown type", () => {
    expect(validateRow(row({ line: "Supplier Name (telephone)" })).blocking).toHaveLength(1);
  });

  it("blocks an empty enum", () => {
    expect(validateRow(row({ line: "Status (options: )" })).blocking).toHaveLength(1);
  });

  it("warns with a correction for a misspelled modifier", () => {
    const validation = validateRow(row({ line: "Status (optoins: A, B)" }));
    expect(validation.blocking).toEqual([]);
    expect(validation.warnings[0]?.correctedLine).toBe("Status (options: A, B)");
  });

  it("never blocks on a locked section row", () => {
    // A section's raw open tag is not a Label (annotations) line, so parsing it
    // as one would flag a construct the author cannot edit here anyway.
    expect(validateRow(row({ locked: true, line: "#Pricing" })).blocking).toEqual([]);
  });

  it("does not flag an empty row", () => {
    expect(validateRow(row({ line: "" })).blocking).toEqual([]);
  });
});

describe("isLowConfidence", () => {
  it("is false for an author-written tag with no confidence", () => {
    expect(isLowConfidence(row())).toBe(false);
  });

  it("is true below the medium-confidence threshold", () => {
    expect(isLowConfidence(row({ confidence: 40 }))).toBe(true);
  });

  it("is false at the medium-confidence threshold", () => {
    expect(isLowConfidence(row({ confidence: 50 }))).toBe(false);
  });

  it("is false for a high-confidence suggestion", () => {
    expect(isLowConfidence(row({ confidence: 95 }))).toBe(false);
  });
});

describe("duplicateCounts", () => {
  it("counts a label used by more than one row", () => {
    const counts = duplicateCounts([
      row({ id: "a", line: "Supplier Name (text)" }),
      row({ id: "b", line: "Supplier Name (text)" }),
      row({ id: "c", line: "Amount (currency)" }),
    ]);
    expect(counts.get("supplier_name")).toBe(2);
    expect(counts.has("amount")).toBe(false);
  });

  it("counts one row that fills several places in the document", () => {
    const counts = duplicateCounts([
      row({
        occurrences: [
          { sourceText: "{{ Supplier Name }}", occurrence: 0 },
          { sourceText: "{{ Supplier Name }}", occurrence: 1 },
          { sourceText: "{{ Supplier Name }}", occurrence: 2 },
        ],
      }),
    ]);
    expect(counts.get("supplier_name")).toBe(3);
  });

  it("ignores locked rows", () => {
    expect(duplicateCounts([row({ locked: true }), row({ id: "b", locked: true })]).size).toBe(0);
  });
});

describe("canSave", () => {
  it("allows a clean single-field set", () => {
    expect(canSave([row()])).toBe(true);
  });

  it("blocks while any row has a blocking error", () => {
    expect(canSave([row(), row({ id: "b", line: "X (telephone)" })])).toBe(false);
  });

  it("blocks until a low-confidence row is confirmed", () => {
    expect(canSave([row({ confidence: 30 })])).toBe(false);
  });

  it("allows once the low-confidence row is confirmed", () => {
    expect(canSave([row({ confidence: 30, confirmed: true })])).toBe(true);
  });

  it("does not gate on a high-confidence row", () => {
    expect(canSave([row({ confidence: 90 })])).toBe(true);
  });

  it("blocks a field set with nothing in it", () => {
    expect(canSave([row({ line: "  " })])).toBe(false);
  });

  it("blocks a set containing only locked rows, which capture nothing", () => {
    expect(canSave([row({ locked: true, line: "#Pricing" })])).toBe(false);
  });

  it("ignores a cleared suggestion when judging the rest of the set", () => {
    expect(canSave([row(), row({ id: "b", kind: "span", line: "", confidence: 20 })])).toBe(true);
  });
});

describe("saveBlockedReason", () => {
  it("names the validation problem first", () => {
    const reason = saveBlockedReason([row({ line: "X (telephone)" }), row({ id: "b", confidence: 10 })]);
    expect(reason).toMatch(/fix/i);
  });

  it("names the confirmation requirement when validation is clean", () => {
    expect(saveBlockedReason([row({ confidence: 10 })])).toMatch(/confirm/i);
  });

  it("names the empty field set", () => {
    expect(saveBlockedReason([row({ line: "" })])).toMatch(/at least one/i);
  });

  it("is null when saving is allowed", () => {
    expect(saveBlockedReason([row()])).toBeNull();
  });
});

describe("toEditableRows", () => {
  it("gives every row a stable id", () => {
    const rows = toEditableRows([
      { ...row(), id: undefined } as never,
      { ...row(), key: "amount", id: undefined } as never,
    ]);
    expect(new Set(rows.map((entry) => entry.id)).size).toBe(2);
  });

  it("starts every row unconfirmed", () => {
    expect(toEditableRows([{ ...row(), confidence: 20 } as never])[0]?.confirmed).toBe(false);
  });
});
