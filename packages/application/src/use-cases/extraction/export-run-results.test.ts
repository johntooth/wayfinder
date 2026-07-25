import { describe, expect, it, vi } from "vitest";
import {
  ok,
  type ExtractionRecord,
  type ExtractionRun,
  type ExtractionSchema,
  type FlowVersion,
  type Result,
  type WriteSpreadsheetInput,
} from "@rbrasier/domain";
import { ExportRunResults } from "./export-run-results";

const run: ExtractionRun = {
  id: "run-1",
  flowId: "flow-1",
  flowVersionId: "version-1",
  initiatedByUserId: "user-1",
  mode: "full",
  status: "complete",
  previewBoundary: 0,
  totalCount: 2,
  doneCount: 2,
  failedCount: 0,
  unreadableCount: 0,
  costUsd: 0,
};

const schema: ExtractionSchema = {
  fields: [
    { field: { key: "supplier", label: "Supplier", type: "text", optional: false, raw: "" }, instruction: "", doneWhen: null },
    { field: { key: "price", label: "Price", type: "currency", optional: false, raw: "" }, instruction: "", doneWhen: null },
  ],
  input: { cardinality: "one_per_file", selectionCriteria: null, guidance: "" },
  output: {
    format: "docx",
    outputTemplate: null,
    instruction: "",
    generateSummary: false,
    summaryTemplate: null,
    contextDocs: [],
  },
};

const records: ExtractionRecord[] = [
  {
    id: "rec-1",
    label: "Acme",
    fields: [
      { key: "supplier", value: "Acme Ltd", confidence: 0.9, rationale: "cover page" },
      { key: "price", value: "£10", confidence: 0.4, rationale: "guessed" },
    ],
    sourceDocumentIds: ["doc-1"],
  },
];

const buildDeps = () => {
  const stored: Array<{ key: string; data: Buffer }> = [];
  const runs = {
    getRun: vi.fn(async (): Promise<Result<ExtractionRun>> => ok(run)),
    listRecords: vi.fn(async (): Promise<Result<ExtractionRecord[]>> => ok(records)),
  };
  const flowVersions = {
    getById: vi.fn(async (): Promise<Result<FlowVersion | null>> =>
      ok({
        id: "version-1",
        flowId: "flow-1",
        versionNumber: 1,
        status: "published",
        snapshot: { kind: "extraction", metadata: {}, nodes: [], edges: [], extraction: schema },
        createdAt: new Date(),
      } as unknown as FlowVersion),
    ),
  };
  let lastWorkbook: WriteSpreadsheetInput | null = null;
  const spreadsheetWriter = {
    write: vi.fn((input: WriteSpreadsheetInput) => {
      lastWorkbook = input;
      return ok({ bytes: Buffer.from("xlsx-bytes") });
    }),
  };
  const storage = {
    put: vi.fn(async (key: string, data: Buffer) => {
      stored.push({ key, data });
      return ok({ key });
    }),
  };
  const auditLogger = { log: vi.fn(async () => ok(true as const)) };

  return {
    stored,
    runs,
    flowVersions,
    spreadsheetWriter,
    storage,
    auditLogger,
    getWorkbook: () => lastWorkbook!,
    useCase: new ExportRunResults(
      runs as never,
      flowVersions as never,
      spreadsheetWriter as never,
      storage as never,
      auditLogger as never,
    ),
  };
};

describe("ExportRunResults", () => {
  it("stores an XLSX and a JSON artifact and returns their keys", async () => {
    const deps = buildDeps();
    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      xlsxKey: "extraction-runs/run-1/exports/results.xlsx",
      jsonKey: "extraction-runs/run-1/exports/results.json",
      recordCount: 1,
    });
    expect(deps.stored.map((entry) => entry.key).sort()).toEqual([
      "extraction-runs/run-1/exports/results.json",
      "extraction-runs/run-1/exports/results.xlsx",
    ]);
  });

  it("writes two tabs — extracted data first, confidence second", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(deps.getWorkbook().sheets.map((sheet) => sheet.name)).toEqual([
      "Extracted data",
      "Confidence",
    ]);
  });

  it("gives the data tab a column per field in schema order, values only", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const dataTab = deps.getWorkbook().sheets[0]!;
    expect(dataTab.columns.map((column) => column.key)).toEqual(["record", "supplier", "price"]);
    expect(dataTab.rows).toEqual([{ record: "Acme", supplier: "Acme Ltd", price: "£10" }]);
  });

  it("keeps confidence and rationale out of the data tab", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const dataTab = deps.getWorkbook().sheets[0]!;
    const keys = dataTab.columns.map((column) => column.key);
    expect(keys.some((key) => key.includes("confidence"))).toBe(false);
    expect(keys.some((key) => key.includes("rationale"))).toBe(false);
  });

  it("gives the confidence tab one row per record and field, with band and rationale", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const confidenceTab = deps.getWorkbook().sheets[1]!;
    expect(confidenceTab.columns.map((column) => column.key)).toEqual([
      "record",
      "field",
      "value",
      "confidence",
      "band",
      "rationale",
    ]);
    expect(confidenceTab.rows).toEqual([
      {
        record: "Acme",
        field: "Supplier",
        value: "Acme Ltd",
        confidence: "90",
        band: "green",
        rationale: "cover page",
      },
      {
        record: "Acme",
        field: "Price",
        value: "£10",
        confidence: "40",
        band: "red",
        rationale: "guessed",
      },
    ]);
  });

  it("writes a blank data cell and a zero-confidence row for a field the record is missing", async () => {
    const deps = buildDeps();
    deps.runs.listRecords.mockResolvedValueOnce(
      ok([{ ...records[0]!, fields: [records[0]!.fields[0]!] }]),
    );
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const workbook = deps.getWorkbook();
    expect(workbook.sheets[0]!.rows[0]).toMatchObject({ price: "" });
    expect(workbook.sheets[1]!.rows).toHaveLength(2);
    expect(workbook.sheets[1]!.rows[1]).toMatchObject({ field: "Price", value: "", confidence: "0" });
  });

  it("writes the full records (with rationale + sources) into the JSON artifact", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    const jsonEntry = deps.stored.find((entry) => entry.key.endsWith(".json"))!;
    const payload = JSON.parse(jsonEntry.data.toString("utf8"));
    expect(payload.records[0].fields[0]).toEqual({
      key: "supplier",
      value: "Acme Ltd",
      confidence: 0.9,
      rationale: "cover page",
    });
    expect(payload.records[0].sourceDocumentIds).toEqual(["doc-1"]);
  });

  it("writes an audit event for the export", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "extraction_run.exported",
        resourceType: "extraction_run",
        resourceId: "run-1",
      }),
    );
  });
});
