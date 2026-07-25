import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { SpreadsheetParser } from "../hr/spreadsheet-parser";
import { XlsxWriter } from "./xlsx-writer";

const readSheet = (bytes: Buffer, index = 1): string => {
  const zip = new PizZip(bytes);
  return zip.file(`xl/worksheets/sheet${index}.xml`)?.asText() ?? "";
};

const oneSheet = (
  name: string,
  columns: Array<{ key: string; label: string }>,
  rows: Array<Record<string, string>>,
) => ({ sheets: [{ name, columns, rows }] });

describe("XlsxWriter", () => {
  const writer = new XlsxWriter();

  it("writes a valid workbook with the five OOXML parts", () => {
    const result = writer.write(oneSheet("Results", [{ key: "name", label: "Name" }], [{ name: "Acme" }]));
    expect(result.error).toBeUndefined();

    const files = Object.keys(new PizZip(result.data!.bytes).files);
    expect(files).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/worksheets/sheet1.xml",
      ]),
    );
  });

  it("writes the header row and one row per record as inline strings", () => {
    const result = writer.write(
      oneSheet(
        "Results",
        [
          { key: "supplier", label: "Supplier" },
          { key: "price", label: "Price" },
        ],
        [
          { supplier: "Acme", price: "£10" },
          { supplier: "Globex", price: "£20" },
        ],
      ),
    );

    const sheet = readSheet(result.data!.bytes);
    expect(sheet).toContain("<t xml:space=\"preserve\">Supplier</t>");
    expect(sheet).toContain("<t xml:space=\"preserve\">Acme</t>");
    expect(sheet).toContain("<t xml:space=\"preserve\">Globex</t>");
    // Header + two data rows.
    expect(sheet.match(/<row /g)).toHaveLength(3);
  });

  it("escapes XML-special characters in values", () => {
    const result = writer.write(oneSheet("Results", [{ key: "note", label: "Note" }], [{ note: "A & B < C" }]));
    expect(readSheet(result.data!.bytes)).toContain("A &amp; B &lt; C");
  });

  it("writes a blank cell when a row is missing a column key", () => {
    const result = writer.write(
      oneSheet(
        "Results",
        [
          { key: "a", label: "A" },
          { key: "b", label: "B" },
        ],
        [{ a: "only-a" }],
      ),
    );
    const sheet = readSheet(result.data!.bytes);
    expect(sheet).toContain("only-a");
    // The missing B cell is present but empty, keeping the grid rectangular.
    expect(sheet.match(/r="B2"/)).not.toBeNull();
  });

  it("still writes the header when there are no rows", () => {
    const result = writer.write(oneSheet("Results", [{ key: "a", label: "A" }], []));
    const sheet = readSheet(result.data!.bytes);
    expect(sheet).toContain(">A<");
    expect(sheet.match(/<row /g)).toHaveLength(1);
  });

  it("sanitises an invalid sheet name (forbidden characters, length)", () => {
    const result = writer.write(oneSheet("Runs/2026: results [final]", [{ key: "a", label: "A" }], []));
    const workbook = new PizZip(result.data!.bytes).file("xl/workbook.xml")?.asText() ?? "";
    expect(workbook).not.toMatch(/name="[^"]*[\\/:?*[\]][^"]*"/);
  });

  describe("multiple sheets", () => {
    const twoSheets = () =>
      writer.write({
        sheets: [
          {
            name: "Extracted data",
            columns: [
              { key: "record", label: "Record" },
              { key: "price", label: "Price" },
            ],
            rows: [{ record: "Acme", price: "£10" }],
          },
          {
            name: "Confidence",
            columns: [
              { key: "field", label: "Field" },
              { key: "band", label: "Band" },
            ],
            rows: [{ field: "price", band: "green" }],
          },
        ],
      });

    it("writes one worksheet part per sheet", () => {
      const files = Object.keys(new PizZip(twoSheets().data!.bytes).files);
      expect(files).toEqual(
        expect.arrayContaining(["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]),
      );
    });

    it("declares every worksheet in the workbook, in the order given", () => {
      const workbook = new PizZip(twoSheets().data!.bytes).file("xl/workbook.xml")?.asText() ?? "";
      const names = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1]);
      expect(names).toEqual(["Extracted data", "Confidence"]);
    });

    it("relates each declared sheet to its own worksheet part", () => {
      const zip = new PizZip(twoSheets().data!.bytes);
      const workbook = zip.file("xl/workbook.xml")?.asText() ?? "";
      const rels = zip.file("xl/_rels/workbook.xml.rels")?.asText() ?? "";

      const relationshipIds = [...workbook.matchAll(/r:id="([^"]+)"/g)].map((match) => match[1]);
      expect(relationshipIds).toEqual(["rId1", "rId2"]);

      // Each r:id must resolve to a distinct worksheet target, or Excel opens the
      // wrong tab (or refuses the package outright).
      const targets = relationshipIds.map(
        (id) => new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? null,
      );
      expect(targets).toEqual(["worksheets/sheet1.xml", "worksheets/sheet2.xml"]);
    });

    it("declares a content-type override for every worksheet part", () => {
      const contentTypes =
        new PizZip(twoSheets().data!.bytes).file("[Content_Types].xml")?.asText() ?? "";
      expect(contentTypes).toContain('PartName="/xl/worksheets/sheet1.xml"');
      expect(contentTypes).toContain('PartName="/xl/worksheets/sheet2.xml"');
    });

    it("round-trips the first tab through an independent reader", async () => {
      // Asserting our own XML back at ourselves would not catch a malformed
      // package. SpreadsheetParser resolves the first tab through workbook.xml and
      // its rels the way Excel does, so a broken relationship surfaces here.
      const parsed = await new SpreadsheetParser().parse({
        content: twoSheets().data!.bytes,
        format: "xlsx",
      });

      expect(parsed.error).toBeUndefined();
      expect(parsed.data?.columns).toEqual(["Record", "Price"]);
      expect(parsed.data?.rows).toEqual([{ Record: "Acme", Price: "£10" }]);
    });

    it("rejects a workbook with no sheets", () => {
      const result = writer.write({ sheets: [] });
      expect(result.data).toBeUndefined();
      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });
  });
});
