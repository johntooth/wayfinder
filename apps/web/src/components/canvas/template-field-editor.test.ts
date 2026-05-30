import { describe, expect, it } from "vitest";
import { parseFieldLines } from "./template-field-editor";

describe("parseFieldLines", () => {
  it("parses valid Label (type) lines into TemplateFields and ignores blanks", () => {
    const result = parseFieldLines(["Preferred Vendor (text)", "", "Approved (yesno)"]);

    expect(result.valid).toBe(true);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]!.key).toBe("preferred_vendor");
    expect(result.fields[1]!.type).toBe("yesno");
  });

  it("flags a malformed annotation as invalid (same parser as .docx tags)", () => {
    const result = parseFieldLines(["Vendor (maxlen: abc)"]);

    expect(result.valid).toBe(false);
  });

  it("is valid and empty when there are no non-blank lines", () => {
    const result = parseFieldLines(["", "  "]);

    expect(result.valid).toBe(true);
    expect(result.fields).toHaveLength(0);
  });
});
