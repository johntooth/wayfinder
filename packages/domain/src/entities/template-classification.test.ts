import { describe, it, expect } from "vitest";
import { classifyTemplateSource } from "./template-classification";

const EMPTY_SKELETON = [
  "SUPPLIER AGREEMENT",
  "",
  "Supplier Name:",
  "ABN:",
  "Contract Value:",
  "Start Date:",
  "End Date:",
  "",
  "Authorised by: ______________________",
  "Date: ____ / ____ / ______",
].join("\n");

const FILLED_EXAMPLE = [
  "SUPPLIER AGREEMENT",
  "",
  "This agreement is made between Northwind Pty Ltd and Acme Trading Pty Ltd on",
  "14 March 2025 for the supply of catering services to the Parramatta campus.",
  "",
  "Acme Trading Pty Ltd will invoice monthly in arrears and payment terms are",
  "thirty days from the date of a correctly rendered tax invoice.",
  "",
  "The total contract value is $184,500.00 excluding GST over a term of 24 months",
  "commencing 1 April 2025 and concluding 31 March 2027.",
].join("\n");

describe("classifyTemplateSource", () => {
  it("classifies any document carrying tags as already annotated", () => {
    expect(classifyTemplateSource(FILLED_EXAMPLE, 3)).toBe("annotated");
    expect(classifyTemplateSource(EMPTY_SKELETON, 1)).toBe("annotated");
  });

  it("classifies a label-only skeleton as an empty template", () => {
    expect(classifyTemplateSource(EMPTY_SKELETON, 0)).toBe("empty");
  });

  it("classifies a prose-heavy document as a filled example", () => {
    expect(classifyTemplateSource(FILLED_EXAMPLE, 0)).toBe("filled");
  });

  it("treats fill-in rules and dotted leaders as empty structure, not content", () => {
    const ruled = [
      "Employee Name .............................",
      "Position ..................................",
      "Manager __________________________________",
    ].join("\n");
    expect(classifyTemplateSource(ruled, 0)).toBe("empty");
  });

  it("defaults an ambiguous document to the filled path", () => {
    // One prose line against one label line — no majority either way. The filled
    // path confirms intent with the user, so it is the safe default (spec §2C).
    const ambiguous = [
      "Supplier Name:",
      "The supplier shall provide catering services to the campus each weekday.",
    ].join("\n");
    expect(classifyTemplateSource(ambiguous, 0)).toBe("filled");
  });

  it("treats a document with no usable text as an empty template", () => {
    expect(classifyTemplateSource("", 0)).toBe("empty");
    expect(classifyTemplateSource("   \n\n  \t ", 0)).toBe("empty");
  });

  it("does not count headings as prose", () => {
    const headings = ["PART A — SCOPE", "PART B — PRICING", "PART C — TERM", "Signed:"].join("\n");
    expect(classifyTemplateSource(headings, 0)).toBe("empty");
  });

  it("counts a dated, numeric sentence as prose", () => {
    const withNumbers = [
      "Invoice 44821 was issued on 3 June 2025 for $12,400.00 including GST.",
      "Payment was received on 2 July 2025 against purchase order PO-99120.",
    ].join("\n");
    expect(classifyTemplateSource(withNumbers, 0)).toBe("filled");
  });
});
