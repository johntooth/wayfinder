import { describe, expect, it } from "vitest";
import {
  exceptionRecordIds,
  fieldColumnKeys,
  fieldValue,
  pairFields,
  toggleExpanded,
  visibleRecords,
} from "./result-grid-model";
import type { ResultFieldValue, ResultRecord, SampleResult } from "./result-grid-model";

const field = (key: string, value: string, confidence = 0.9): ResultFieldValue => ({
  key,
  value,
  confidence,
  rationale: `${key} rationale`,
});

const record = (id: string, label: string, fields: ResultFieldValue[], sources: string[] = []): ResultRecord => ({
  id,
  label,
  fields,
  sourceDocumentIds: sources,
});

const result = (records: ResultRecord[], exceptionFileIds: string[] = []): SampleResult => ({
  documents: [],
  records,
  exceptionFileIds,
});

describe("fieldColumnKeys", () => {
  it("returns the union of field keys in first-seen order", () => {
    const records = [
      record("r1", "Acme", [field("supplier", "Acme"), field("price", "£10")]),
      record("r2", "Globex", [field("price", "£20"), field("term", "12m")]),
    ];

    expect(fieldColumnKeys(records)).toEqual(["supplier", "price", "term"]);
  });

  it("returns no columns for no records", () => {
    expect(fieldColumnKeys([])).toEqual([]);
  });
});

describe("fieldValue", () => {
  it("finds the field on the record by key", () => {
    const target = record("r1", "Acme", [field("supplier", "Acme Ltd")]);
    expect(fieldValue(target, "supplier")?.value).toBe("Acme Ltd");
  });

  it("returns null when the record has no such field", () => {
    const target = record("r1", "Acme", [field("supplier", "Acme Ltd")]);
    expect(fieldValue(target, "price")).toBeNull();
  });
});

describe("pairFields", () => {
  it("groups fields two at a time for the four-column detail layout", () => {
    const fields = [field("a", "1"), field("b", "2"), field("c", "3"), field("d", "4")];
    expect(pairFields(fields)).toEqual([
      [fields[0], fields[1]],
      [fields[2], fields[3]],
    ]);
  });

  it("leaves the trailing slot empty on an odd field count", () => {
    const fields = [field("a", "1"), field("b", "2"), field("c", "3")];
    expect(pairFields(fields)).toEqual([
      [fields[0], fields[1]],
      [fields[2], null],
    ]);
  });

  it("returns no rows for no fields", () => {
    expect(pairFields([])).toEqual([]);
  });
});

describe("toggleExpanded", () => {
  it("adds an id that is not expanded", () => {
    expect([...toggleExpanded(new Set(), "r1")]).toEqual(["r1"]);
  });

  it("removes an id that is already expanded", () => {
    expect([...toggleExpanded(new Set(["r1", "r2"]), "r1")]).toEqual(["r2"]);
  });

  it("does not mutate the set it is given", () => {
    const expanded = new Set(["r1"]);
    toggleExpanded(expanded, "r2");
    expect([...expanded]).toEqual(["r1"]);
  });
});

describe("exceptionRecordIds", () => {
  it("flags a record that drew on an exception file", () => {
    const source = result([record("r1", "Acme", [field("supplier", "Acme")], ["doc-1"])], ["doc-1"]);
    expect([...exceptionRecordIds(source)]).toEqual(["r1"]);
  });

  it("flags a record whose every field is blank", () => {
    const source = result([record("r1", "Acme", [field("supplier", "  ")])]);
    expect([...exceptionRecordIds(source)]).toEqual(["r1"]);
  });

  it("leaves a fully populated record off the exception list", () => {
    const source = result([record("r1", "Acme", [field("supplier", "Acme")], ["doc-1"])], ["doc-9"]);
    expect([...exceptionRecordIds(source)]).toEqual([]);
  });
});

describe("visibleRecords", () => {
  const records = [
    record("r1", "Acme", [field("supplier", "Acme Ltd")], ["doc-1"]),
    record("r2", "Globex", [field("supplier", "Globex plc")]),
  ];
  const source = result(records, ["doc-1"]);

  it("returns every record when unfiltered", () => {
    expect(visibleRecords(source, { query: "", exceptionsOnly: false }).map((entry) => entry.id)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("matches the query against the record label", () => {
    expect(visibleRecords(source, { query: "glob", exceptionsOnly: false }).map((entry) => entry.id)).toEqual([
      "r2",
    ]);
  });

  it("matches the query against a field value", () => {
    expect(visibleRecords(source, { query: "plc", exceptionsOnly: false }).map((entry) => entry.id)).toEqual([
      "r2",
    ]);
  });

  it("narrows to exceptions when asked", () => {
    expect(visibleRecords(source, { query: "", exceptionsOnly: true }).map((entry) => entry.id)).toEqual([
      "r1",
    ]);
  });

  it("applies the query and the exceptions filter together", () => {
    expect(visibleRecords(source, { query: "globex", exceptionsOnly: true })).toEqual([]);
  });
});
