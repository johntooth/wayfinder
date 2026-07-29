import { describe, it, expect } from "vitest";
import {
  buildAnnotationEdits,
  contextFor,
  rowsFromDocumentTags,
  rowsFromSuggestions,
} from "./template-annotation";

describe("rowsFromDocumentTags", () => {
  it("returns one row per tag, in document order", () => {
    const rows = rowsFromDocumentTags("Supplier: {{ Supplier Name }}\nValue: {{ Amount }}");
    expect(rows.map((row) => row.line)).toEqual(["Supplier Name", "Amount"]);
  });

  it("captures the exact literal so the annotator can match it", () => {
    const rows = rowsFromDocumentTags("Supplier: {{  Supplier Name  }}");
    expect(rows[0]?.occurrences[0]?.sourceText).toBe("{{  Supplier Name  }}");
  });

  it("collapses repeated uses of one field into a single row", () => {
    const rows = rowsFromDocumentTags(
      "{{ Supplier Name }} agrees. {{ Supplier Name }} will invoice.",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrences).toHaveLength(2);
  });

  it("indexes each repeated literal by its own occurrence", () => {
    const rows = rowsFromDocumentTags("{{ Name }} and {{ Name }}");
    expect(rows[0]?.occurrences.map((entry) => entry.occurrence)).toEqual([0, 1]);
  });

  it("preserves an annotated tag's existing annotations", () => {
    const rows = rowsFromDocumentTags("{{ Amount (currency) (optional) }}");
    expect(rows[0]?.line).toBe("Amount (currency) (optional)");
  });

  it("locks a section tag rather than offering it for editing", () => {
    const rows = rowsFromDocumentTags("{{#Pricing}} Rate: {{ Rate }} {{/Pricing}}");
    const pricing = rows.find((row) => row.line.includes("Pricing"));
    expect(pricing?.locked).toBe(true);
    expect(rows.find((row) => row.line === "Rate")?.locked).toBe(false);
  });

  it("keeps a close tag out of the row list, since it has no field of its own", () => {
    const rows = rowsFromDocumentTags("{{#Pricing}} x {{/Pricing}}");
    expect(rows).toHaveLength(1);
  });

  it("marks every row as an existing tag", () => {
    const rows = rowsFromDocumentTags("{{ Supplier Name }}");
    expect(rows[0]?.kind).toBe("tag");
  });

  it("carries no confidence for an author-written tag", () => {
    expect(rowsFromDocumentTags("{{ Supplier Name }}")[0]?.confidence).toBeNull();
  });

  it("returns nothing for a document with no tags", () => {
    expect(rowsFromDocumentTags("Plain prose with no placeholders.")).toEqual([]);
  });

  it("keeps a malformed tag as a row so the author can fix it", () => {
    const rows = rowsFromDocumentTags("{{ Supplier (telephone) }}");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.line).toBe("Supplier (telephone)");
  });
});

describe("rowsFromSuggestions", () => {
  const suggestion = (overrides: Record<string, unknown> = {}) => ({
    label: "Supplier Name",
    line: "Supplier Name (text)",
    type: "text" as const,
    sourceText: "Acme Pty Ltd",
    occurrence: 0,
    context: "Made with Acme Pty Ltd.",
    confidence: 88,
    ...overrides,
  });

  it("marks a suggestion as a span to be replaced", () => {
    const rows = rowsFromSuggestions([suggestion()]);
    expect(rows[0]?.kind).toBe("span");
  });

  it("carries the original value so the author can verify the inference", () => {
    const rows = rowsFromSuggestions([suggestion()]);
    expect(rows[0]?.originalValue).toBe("Acme Pty Ltd");
  });

  it("carries the confidence through for the confidence bar", () => {
    expect(rowsFromSuggestions([suggestion({ confidence: 42 })])[0]?.confidence).toBe(42);
  });

  it("keeps two suggestions over the same text as separate rows", () => {
    const rows = rowsFromSuggestions([
      suggestion({ occurrence: 0 }),
      suggestion({ label: "Second", line: "Second (text)", occurrence: 1 }),
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("buildAnnotationEdits", () => {
  const tagRow = {
    key: "supplier_name",
    kind: "tag" as const,
    line: "Supplier Name (text)",
    occurrences: [{ sourceText: "{{ Supplier Name }}", occurrence: 0 }],
    context: "",
    originalValue: null,
    confidence: null,
    locked: false,
  };

  it("wraps the edited line in braces", () => {
    const edits = buildAnnotationEdits([tagRow]);
    expect(edits).toEqual([
      { find: "{{ Supplier Name }}", occurrence: 0, replacement: "{{ Supplier Name (text) }}" },
    ]);
  });

  it("emits one edit per occurrence so every use of a field is updated", () => {
    const edits = buildAnnotationEdits([
      {
        ...tagRow,
        occurrences: [
          { sourceText: "{{ Supplier Name }}", occurrence: 0 },
          { sourceText: "{{ Supplier Name }}", occurrence: 1 },
        ],
      },
    ]);
    expect(edits).toHaveLength(2);
    expect(edits.map((edit) => edit.occurrence)).toEqual([0, 1]);
  });

  it("removes an existing tag whose field name the author cleared", () => {
    const edits = buildAnnotationEdits([{ ...tagRow, line: "   " }]);
    expect(edits[0]?.replacement).toBe("");
  });

  it("leaves the document untouched for a suggestion the author cleared", () => {
    const edits = buildAnnotationEdits([
      {
        key: "supplier_name",
        kind: "span",
        line: "",
        occurrences: [{ sourceText: "Acme Pty Ltd", occurrence: 0 }],
        context: "",
        originalValue: "Acme Pty Ltd",
        confidence: 88,
        locked: false,
      },
    ]);
    expect(edits).toEqual([]);
  });

  it("never rewrites a locked section row", () => {
    const edits = buildAnnotationEdits([
      { ...tagRow, locked: true, line: "#Pricing", occurrences: [{ sourceText: "{{#Pricing}}", occurrence: 0 }] },
    ]);
    expect(edits).toEqual([]);
  });

  it("converts a filled example's value into a placeholder", () => {
    const edits = buildAnnotationEdits([
      {
        key: "supplier_name",
        kind: "span",
        line: "Supplier Name (text)",
        occurrences: [{ sourceText: "Acme Pty Ltd", occurrence: 0 }],
        context: "",
        originalValue: "Acme Pty Ltd",
        confidence: 88,
        locked: false,
      },
    ]);
    expect(edits).toEqual([
      { find: "Acme Pty Ltd", occurrence: 0, replacement: "{{ Supplier Name (text) }}" },
    ]);
  });

  it("skips an edit that would replace text with an identical tag", () => {
    const edits = buildAnnotationEdits([
      { ...tagRow, line: "Supplier Name", occurrences: [{ sourceText: "{{ Supplier Name }}", occurrence: 0 }] },
    ]);
    expect(edits).toEqual([]);
  });
});

describe("contextFor", () => {
  const TEXT = [
    "SUPPLIER AGREEMENT",
    "This agreement is made with Acme Pty Ltd for catering services.",
    "Payment terms are thirty days.",
  ].join("\n");

  it("returns the line containing the span", () => {
    expect(contextFor(TEXT, "Acme Pty Ltd", 0)).toBe(
      "This agreement is made with Acme Pty Ltd for catering services.",
    );
  });

  it("returns the line of the requested occurrence", () => {
    const text = "First Acme line.\nSecond Acme line.";
    expect(contextFor(text, "Acme", 1)).toBe("Second Acme line.");
  });

  it("returns an empty string when the span is absent", () => {
    expect(contextFor(TEXT, "Northwind", 0)).toBe("");
  });

  it("truncates a very long line around the span", () => {
    const long = `${"word ".repeat(80)}Acme Pty Ltd${" word".repeat(80)}`;
    const context = contextFor(long, "Acme Pty Ltd", 0);
    expect(context.length).toBeLessThanOrEqual(200);
    expect(context).toContain("Acme Pty Ltd");
  });
});
