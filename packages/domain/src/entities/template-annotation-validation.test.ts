import { describe, it, expect } from "vitest";
import {
  findDuplicateLabels,
  suggestModifierCorrection,
  validateAnnotationLine,
} from "./template-annotation-validation";

describe("suggestModifierCorrection", () => {
  it("corrects a transposed modifier", () => {
    expect(suggestModifierCorrection("optoins")).toBe("options");
  });

  it("corrects a misspelled type keyword", () => {
    expect(suggestModifierCorrection("curency")).toBe("currency");
    expect(suggestModifierCorrection("emial")).toBe("email");
  });

  it("returns null when nothing is close enough", () => {
    expect(suggestModifierCorrection("supplier")).toBeNull();
    expect(suggestModifierCorrection("")).toBeNull();
  });

  it("returns null for a modifier that is already valid", () => {
    expect(suggestModifierCorrection("options")).toBeNull();
    expect(suggestModifierCorrection("maxlen")).toBeNull();
  });
});

describe("validateAnnotationLine — blocking", () => {
  it("accepts a well-formed line", () => {
    const result = validateAnnotationLine("Supplier Name (text) (maxlen: 80)");
    expect(result.blocking).toEqual([]);
  });

  it("blocks an unknown type", () => {
    const result = validateAnnotationLine("Supplier Name (telephone)");
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]).toContain("telephone");
  });

  it("blocks unclosed braces", () => {
    const result = validateAnnotationLine("{{ Supplier Name (text)");
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]).toMatch(/brace/i);
  });

  it("blocks an unclosed annotation bracket", () => {
    const result = validateAnnotationLine("Supplier Name (text");
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]).toMatch(/bracket|parenthes/i);
  });

  it("blocks an empty enum", () => {
    const result = validateAnnotationLine("Status (options: )");
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]).toMatch(/options/i);
  });

  it("blocks a line with no field name", () => {
    const result = validateAnnotationLine("(text)");
    expect(result.blocking).toHaveLength(1);
  });

  it("accepts a line the author wrapped in braces", () => {
    // The raw annotation string is the teaching surface, so an author who copies
    // it back verbatim from Word must not be told it is malformed.
    const result = validateAnnotationLine("{{ Supplier Name (text) }}");
    expect(result.blocking).toEqual([]);
  });
});

describe("validateAnnotationLine — warnings", () => {
  it("suggests a correction for an unrecognised modifier", () => {
    const result = validateAnnotationLine("Status (optoins: A, B)");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.correctedLine).toBe("Status (options: A, B)");
  });

  it("does not treat a correctable modifier as blocking", () => {
    const result = validateAnnotationLine("Status (optoins: A, B)");
    expect(result.blocking).toEqual([]);
  });

  it("flags a trailing colon on the field name", () => {
    const result = validateAnnotationLine("Supplier Name: (text)");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.kind).toBe("suspicious-name");
    expect(result.warnings[0]?.correctedLine).toBe("Supplier Name (text)");
  });

  it("flags a doubled internal space in the field name", () => {
    const result = validateAnnotationLine("Supplier  Name (text)");
    expect(result.warnings[0]?.kind).toBe("suspicious-name");
    expect(result.warnings[0]?.correctedLine).toBe("Supplier Name (text)");
  });

  it("returns no warnings for a clean line", () => {
    expect(validateAnnotationLine("Supplier Name (text) (maxlen: 80)").warnings).toEqual([]);
  });

  it("returns no warnings for an empty line", () => {
    const result = validateAnnotationLine("   ");
    expect(result.blocking).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("findDuplicateLabels", () => {
  it("reports a label used more than once with its count", () => {
    const duplicates = findDuplicateLabels([
      "Supplier Name (text)",
      "Contract Value (currency)",
      "Supplier Name (text)",
      "Supplier Name (text)",
    ]);
    expect(duplicates).toEqual([{ label: "Supplier Name", count: 3 }]);
  });

  it("matches on the derived key, so casing and spacing do not hide a duplicate", () => {
    const duplicates = findDuplicateLabels(["Supplier Name (text)", "supplier name (text)"]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.count).toBe(2);
  });

  it("returns nothing when every label is distinct", () => {
    expect(findDuplicateLabels(["Supplier Name (text)", "ABN (text)"])).toEqual([]);
  });

  it("ignores blank and unparseable lines", () => {
    expect(findDuplicateLabels(["", "   ", "(text)"])).toEqual([]);
  });
});
