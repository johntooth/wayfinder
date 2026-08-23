import { describe, expect, it } from "vitest";
import type { PendingSchemaRequest, SchemaRequestFieldDraft } from "@rbrasier/domain";
import {
  applyTypeChange,
  carriesOptions,
  parseOptionsInput,
  seedRows,
  withRowRemoved,
} from "./schema-request-card-model";

const row = (overrides: Partial<SchemaRequestFieldDraft> = {}): SchemaRequestFieldDraft => ({
  label: "Supplier Name",
  type: "text",
  required: true,
  options: [],
  min: null,
  max: null,
  instruction: "",
  ...overrides,
});

const request = (proposedFields: SchemaRequestFieldDraft[]): PendingSchemaRequest => ({
  toolName: "request_schema_definition",
  prompt: "Define the report.",
  proposedFields,
  status: "pending",
});

describe("seedRows", () => {
  it("starts from the fields the model proposed", () => {
    expect(seedRows(request([row(), row({ label: "Value" })]))).toHaveLength(2);
  });

  it("gives one blank row when the model proposed none", () => {
    const rows = seedRows(request([]));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("");
  });

  it("copies the rows so editing cannot mutate the persisted request", () => {
    const original = request([row()]);
    const rows = seedRows(original);
    rows[0]!.label = "Edited";

    expect(original.proposedFields[0]?.label).toBe("Supplier Name");
  });
});

describe("applyTypeChange", () => {
  it("keeps choices when moving between option-backed types", () => {
    const changed = applyTypeChange(row({ type: "select", options: ["A", "B"] }), "multiselect");

    expect(changed.options).toEqual(["A", "B"]);
  });

  it("clears choices on a type that cannot carry them", () => {
    const changed = applyTypeChange(row({ type: "select", options: ["A"] }), "text");

    expect(changed.options).toEqual([]);
  });

  it("clears bounds on a type that cannot carry them", () => {
    const changed = applyTypeChange(row({ type: "number", min: 1, max: 9 }), "text");

    expect(changed.min).toBeNull();
    expect(changed.max).toBeNull();
  });

  it("keeps bounds when moving between numeric types", () => {
    const changed = applyTypeChange(row({ type: "number", min: 1, max: 9 }), "currency");

    expect(changed.min).toBe(1);
    expect(changed.max).toBe(9);
  });

  it("leaves the label and requiredness alone", () => {
    const changed = applyTypeChange(row({ label: "Value", required: false }), "number");

    expect(changed.label).toBe("Value");
    expect(changed.required).toBe(false);
  });
});

describe("withRowRemoved", () => {
  it("removes the row at the index", () => {
    const rows = withRowRemoved([row({ label: "A" }), row({ label: "B" })], 0);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("B");
  });

  it("leaves a blank row rather than an empty form", () => {
    const rows = withRowRemoved([row()], 0);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("");
  });
});

describe("parseOptionsInput", () => {
  it("splits and trims the choices", () => {
    expect(parseOptionsInput("Goods, Services")).toEqual(["Goods", "Services"]);
  });

  it("drops blank entries left by a trailing comma", () => {
    expect(parseOptionsInput("Goods, ,Services,")).toEqual(["Goods", "Services"]);
  });

  it("yields nothing for an empty input", () => {
    expect(parseOptionsInput("   ")).toEqual([]);
  });
});

describe("carriesOptions", () => {
  it.each(["select", "multiselect"])("is true for %s", (type) => {
    expect(carriesOptions(type)).toBe(true);
  });

  it.each(["text", "number", "date"])("is false for %s", (type) => {
    expect(carriesOptions(type)).toBe(false);
  });
});
