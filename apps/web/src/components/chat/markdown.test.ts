import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdownBlocks } from "./markdown";

describe("parseMarkdownBlocks", () => {
  it("treats a run of plain lines as one paragraph", () => {
    expect(parseMarkdownBlocks("hello\nthere")).toEqual([
      { type: "paragraph", content: "hello\nthere" },
    ]);
  });

  it("splits paragraphs on a blank line", () => {
    expect(parseMarkdownBlocks("first\n\nsecond")).toEqual([
      { type: "paragraph", content: "first" },
      { type: "paragraph", content: "second" },
    ]);
  });

  it("reads every heading level as a heading block", () => {
    expect(parseMarkdownBlocks("# Big\n\n#### Small")).toEqual([
      { type: "heading", content: "Big" },
      { type: "heading", content: "Small" },
    ]);
  });

  it("groups consecutive bullets into one unordered list", () => {
    expect(parseMarkdownBlocks("- one\n- two\n* three")).toEqual([
      { type: "list", ordered: false, items: ["one", "two", "three"] },
    ]);
  });

  it("groups consecutive numbers into one ordered list", () => {
    expect(parseMarkdownBlocks("1. one\n2. two")).toEqual([
      { type: "list", ordered: true, items: ["one", "two"] },
    ]);
  });

  it("flattens indented bullets rather than leaving them as text", () => {
    expect(parseMarkdownBlocks("- one\n  - nested")).toEqual([
      { type: "list", ordered: false, items: ["one", "nested"] },
    ]);
  });

  it("keeps a fenced code block verbatim", () => {
    expect(parseMarkdownBlocks("```\nconst a = 1;\n```")).toEqual([
      { type: "code", value: "const a = 1;" },
    ]);
  });

  it("does not treat a bullet marker as emphasis mid-paragraph", () => {
    expect(parseMarkdownBlocks("intro\n- one")).toEqual([
      { type: "paragraph", content: "intro" },
      { type: "list", ordered: false, items: ["one"] },
    ]);
  });

  it("returns no blocks for empty input", () => {
    expect(parseMarkdownBlocks("")).toEqual([]);
    expect(parseMarkdownBlocks("   \n  ")).toEqual([]);
  });
});

describe("parseInline", () => {
  it("returns plain text untouched", () => {
    expect(parseInline("just words")).toEqual([{ type: "text", value: "just words" }]);
  });

  it("reads double asterisks as bold", () => {
    expect(parseInline("a **b** c")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " c" },
    ]);
  });

  it("reads single asterisks as italic", () => {
    expect(parseInline("*b*")).toEqual([
      { type: "italic", children: [{ type: "text", value: "b" }] },
    ]);
  });

  it("nests emphasis", () => {
    expect(parseInline("**bold *both* **")).toEqual([
      {
        type: "bold",
        children: [
          { type: "text", value: "bold " },
          { type: "italic", children: [{ type: "text", value: "both" }] },
          { type: "text", value: " " },
        ],
      },
    ]);
  });

  it("reads backticks as code without parsing inside", () => {
    expect(parseInline("`a **b**`")).toEqual([{ type: "code", value: "a **b**" }]);
  });

  it("reads strikethrough", () => {
    expect(parseInline("~~gone~~")).toEqual([
      { type: "strike", children: [{ type: "text", value: "gone" }] },
    ]);
  });

  it("reads a link and keeps its label formatted", () => {
    expect(parseInline("[**site**](https://example.com)")).toEqual([
      {
        type: "link",
        href: "https://example.com",
        children: [{ type: "bold", children: [{ type: "text", value: "site" }] }],
      },
    ]);
  });

  it("renders a link with an unsafe scheme as plain text", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { type: "text", value: "[x](javascript:alert(1))" },
    ]);
  });

  it("allows mailto links", () => {
    expect(parseInline("[mail](mailto:a@b.com)")).toEqual([
      { type: "link", href: "mailto:a@b.com", children: [{ type: "text", value: "mail" }] },
    ]);
  });

  it("leaves arithmetic asterisks alone", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ type: "text", value: "2 * 3 * 4" }]);
  });

  it("leaves snake_case identifiers alone", () => {
    expect(parseInline("call some_long_name now")).toEqual([
      { type: "text", value: "call some_long_name now" },
    ]);
  });

  it("reads underscores as emphasis at word boundaries", () => {
    expect(parseInline("_hi_")).toEqual([
      { type: "italic", children: [{ type: "text", value: "hi" }] },
    ]);
    expect(parseInline("__hi__")).toEqual([
      { type: "bold", children: [{ type: "text", value: "hi" }] },
    ]);
  });

  it("leaves an unclosed delimiter as text", () => {
    expect(parseInline("**not closed")).toEqual([{ type: "text", value: "**not closed" }]);
  });
});
