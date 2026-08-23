import { describe, expect, it } from "vitest";
import {
  parseSchemaRequestSubmission,
  proposedFieldsFromToolArguments,
  type SchemaRequestFieldDraft,
} from "./schema-request";

const draft = (overrides: Partial<SchemaRequestFieldDraft> = {}): SchemaRequestFieldDraft => ({
  label: "Supplier Name",
  type: "text",
  required: true,
  options: [],
  min: null,
  max: null,
  instruction: "The legal entity named on the contract.",
  ...overrides,
});

describe("parseSchemaRequestSubmission", () => {
  it("builds a field set from valid drafts", () => {
    const result = parseSchemaRequestSubmission([draft(), draft({ label: "Contract Value", type: "currency" })]);

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.key).toBe("supplier_name");
    expect(result.data?.[0]?.label).toBe("Supplier Name");
    expect(result.data?.[1]?.type).toBe("currency");
  });

  it("trims the label and the instruction", () => {
    const result = parseSchemaRequestSubmission([
      draft({ label: "  Supplier Name  ", instruction: "  who signed  " }),
    ]);

    expect(result.data?.[0]?.label).toBe("Supplier Name");
    expect(result.data?.[0]?.instruction).toBe("who signed");
  });

  it("rejects an empty field set", () => {
    const result = parseSchemaRequestSubmission([]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("at least one field");
  });

  it("rejects a blank label", () => {
    const result = parseSchemaRequestSubmission([draft({ label: "   " })]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("name");
  });

  it.each(["section", "group", "signature"])("rejects the %s field type by name", (type) => {
    const result = parseSchemaRequestSubmission([draft({ type })]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain(type);
  });

  it("rejects a type outside the vocabulary", () => {
    const result = parseSchemaRequestSubmission([draft({ type: "barcode" })]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("barcode");
  });

  it("rejects two fields that resolve to the same key", () => {
    const result = parseSchemaRequestSubmission([draft({ label: "Supplier Name" }), draft({ label: "supplier name" })]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("supplier_name");
  });

  it("requires at least one option on a select field", () => {
    const result = parseSchemaRequestSubmission([draft({ type: "select", options: [] })]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("choice");
  });

  it("drops blank options and keeps the rest", () => {
    const result = parseSchemaRequestSubmission([
      draft({ type: "multiselect", options: ["Goods", "  ", "Services"] }),
    ]);

    expect(result.data?.[0]?.options).toEqual(["Goods", "Services"]);
  });

  it("clears options on a type that cannot carry them", () => {
    const result = parseSchemaRequestSubmission([draft({ type: "text", options: ["Goods"] })]);

    expect(result.data?.[0]?.options).toEqual([]);
  });

  it("rejects a minimum above its maximum", () => {
    const result = parseSchemaRequestSubmission([draft({ type: "number", min: 10, max: 5 })]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("minimum");
  });

  it("clears a bound on a type that cannot carry one", () => {
    const result = parseSchemaRequestSubmission([draft({ type: "text", min: 1, max: 5 })]);

    expect(result.data?.[0]?.min).toBeNull();
    expect(result.data?.[0]?.max).toBeNull();
  });

  it("keeps bounds on a numeric field", () => {
    const result = parseSchemaRequestSubmission([draft({ type: "number", min: 1, max: 5 })]);

    expect(result.data?.[0]?.min).toBe(1);
    expect(result.data?.[0]?.max).toBe(5);
  });
});

describe("proposedFieldsFromToolArguments", () => {
  it("reads the model's proposed fields", () => {
    const proposed = proposedFieldsFromToolArguments(
      JSON.stringify({ fields: [{ label: "Supplier Name", type: "text", required: true }] }),
    );

    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.label).toBe("Supplier Name");
    expect(proposed[0]?.type).toBe("text");
    expect(proposed[0]?.required).toBe(true);
  });

  it("falls back to text for a type the model invented", () => {
    const proposed = proposedFieldsFromToolArguments(
      JSON.stringify({ fields: [{ label: "Signed By", type: "signature" }] }),
    );

    expect(proposed[0]?.type).toBe("text");
  });

  it("returns one blank row when the arguments carry no fields", () => {
    expect(proposedFieldsFromToolArguments(JSON.stringify({}))).toHaveLength(1);
  });

  it("returns one blank row rather than throwing on unparseable arguments", () => {
    expect(proposedFieldsFromToolArguments("not json")).toHaveLength(1);
  });

  it("ignores a fields value that is not an array", () => {
    expect(proposedFieldsFromToolArguments(JSON.stringify({ fields: "Supplier" }))).toHaveLength(1);
  });
});
