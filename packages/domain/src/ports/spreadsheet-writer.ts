import type { Result } from "../result";

// A column in a from-scratch export sheet: the value key it reads from each row,
// and the human heading written in the header row.
export interface SpreadsheetColumn {
  key: string;
  label: string;
}

// One tab in the workbook: its name, its columns, and its rows. A row is keyed by
// column key; a missing key writes a blank cell.
export interface SpreadsheetSheet {
  name: string;
  columns: SpreadsheetColumn[];
  rows: Array<Record<string, string>>;
}

// Build a fresh workbook (one or more tabs, each a header row + one row per
// record) for the structured export (phase §2.2). Distinct from
// IDocumentGenerator, which fills an uploaded template in place — this writes a
// new .xlsx from nothing. Sheets are written in the order given, which is the
// order Excel shows the tabs in.
export interface WriteSpreadsheetInput {
  sheets: SpreadsheetSheet[];
}

export interface WriteSpreadsheetOutput {
  bytes: Buffer;
}

export interface ISpreadsheetWriter {
  write(input: WriteSpreadsheetInput): Result<WriteSpreadsheetOutput>;
}
