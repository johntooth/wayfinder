import { describe, it, expect, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type { ILanguageModel } from "@rbrasier/domain";
import { SuggestTemplateFields } from "./suggest-template-fields";

const USAGE = {
  promptTokens: 100,
  completionTokens: 50,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const suggestion = (overrides: Record<string, unknown> = {}) => ({
  label: "Supplier Name",
  type: "text",
  optional: false,
  options: [],
  sourceText: "Acme Pty Ltd",
  occurrence: 0,
  context: "This agreement is made with Acme Pty Ltd for catering.",
  confidence: 88,
  ...overrides,
});

const makeLanguageModel = (
  fields: Record<string, unknown>[],
  overrides: Partial<ILanguageModel> = {},
): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(ok({ object: { fields }, usage: USAGE })),
  streamText: vi.fn(),
  streamObject: vi.fn(),
  ...overrides,
});

const DOCUMENT = "This agreement is made with Acme Pty Ltd for catering.";

describe("SuggestTemplateFields", () => {
  it("serialises the annotation line from the model's structured parts", async () => {
    const languageModel = makeLanguageModel([
      suggestion({ label: "Contract Value", type: "currency", sourceText: "Acme Pty Ltd" }),
    ]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.error).toBeUndefined();
    expect(result.data?.suggestions[0]?.line).toBe("Contract Value (currency)");
  });

  it("serialises options and optionality into the line", async () => {
    const languageModel = makeLanguageModel([
      suggestion({ label: "Status", type: "text", optional: true, options: ["Approved", "Rejected"] }),
    ]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.data?.suggestions[0]?.line).toBe("Status (options: Approved, Rejected) (optional)");
  });

  it("serialises a multi-select when the model marks the options as multiple", async () => {
    const languageModel = makeLanguageModel([
      suggestion({
        label: "Equipment Type",
        sourceText: "Acme Pty Ltd",
        options: ["Mobile phone", "Laptop"],
        multiple: true,
      }),
    ]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.data?.suggestions[0]?.line).toBe(
      "Equipment Type (multi-options: Mobile phone, Laptop)",
    );
  });

  it("ignores the multiple flag when there are no options to multi-select", async () => {
    const languageModel = makeLanguageModel([
      suggestion({ label: "Supplier Name", options: [], multiple: true }),
    ]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.data?.suggestions[0]?.line).toBe("Supplier Name");
  });

  it("drops a suggestion whose sourceText is not in the document", async () => {
    const languageModel = makeLanguageModel([
      suggestion({ sourceText: "Northwind Trading Ltd" }),
      suggestion({ label: "Service", sourceText: "catering" }),
    ]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.data?.suggestions).toHaveLength(1);
    expect(result.data?.suggestions[0]?.label).toBe("Service");
  });

  it("drops a suggestion whose occurrence index exceeds the actual count", async () => {
    const languageModel = makeLanguageModel([suggestion({ occurrence: 3 })]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.data?.suggestions).toEqual([]);
  });

  it("keeps a later occurrence when the document really has that many", async () => {
    const languageModel = makeLanguageModel([suggestion({ occurrence: 1 })]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({
      documentText: "Acme Pty Ltd invoiced Acme Pty Ltd",
      mode: "filled",
    });

    expect(result.data?.suggestions).toHaveLength(1);
    expect(result.data?.suggestions[0]?.occurrence).toBe(1);
  });

  it("drops a suggestion with an unusable label rather than emitting a broken line", async () => {
    const languageModel = makeLanguageModel([suggestion({ label: "   " })]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.data?.suggestions).toEqual([]);
  });

  it("returns no suggestions rather than an error when the model fails", async () => {
    const languageModel = makeLanguageModel([], {
      generateObject: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "AI down"))),
    });
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.error).toBeUndefined();
    expect(result.data?.suggestions).toEqual([]);
  });

  it("clamps confidence into the 0–100 range the confidence bar expects", async () => {
    const languageModel = makeLanguageModel([
      suggestion({ confidence: 140 }),
      suggestion({ label: "Service", sourceText: "catering", confidence: -5 }),
    ]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.data?.suggestions[0]?.confidence).toBe(100);
    expect(result.data?.suggestions[1]?.confidence).toBe(0);
  });

  it("orders suggestions by their position in the document", async () => {
    const languageModel = makeLanguageModel([
      suggestion({ label: "Service", sourceText: "catering" }),
      suggestion({ label: "Supplier Name", sourceText: "Acme Pty Ltd" }),
    ]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.data?.suggestions.map((field) => field.label)).toEqual([
      "Supplier Name",
      "Service",
    ]);
  });

  // Word extracts one table cell per line, so a form's caption and the value
  // someone typed arrive as consecutive lines. The model regularly points at the
  // caption; annotating it there would delete the caption and leave the value
  // hard-coded, so the anchor is moved onto the value.
  describe("when the model points at the caption instead of the value", () => {
    const FORM = "Employee Name\nRichard Brasier\n\nRequested By\nJoe Bloggs";

    it("moves the anchor onto the value on the next line", async () => {
      const languageModel = makeLanguageModel([
        suggestion({ label: "Employee Name", sourceText: "Employee Name" }),
      ]);
      const useCase = new SuggestTemplateFields(languageModel);

      const result = await useCase.execute({ documentText: FORM, mode: "filled" });

      expect(result.data?.suggestions[0]?.sourceText).toBe("Richard Brasier");
      expect(result.data?.suggestions[0]?.insertAfter).toBe(false);
    });

    it("moves the anchor onto a value sharing the caption's line", async () => {
      const languageModel = makeLanguageModel([
        suggestion({ label: "Supplier Name", sourceText: "Supplier Name:" }),
      ]);
      const useCase = new SuggestTemplateFields(languageModel);

      const result = await useCase.execute({
        documentText: "Supplier Name: Acme Pty Ltd",
        mode: "filled",
      });

      expect(result.data?.suggestions[0]?.sourceText).toBe("Acme Pty Ltd");
    });

    it("indexes the moved anchor by its own occurrence count", async () => {
      const languageModel = makeLanguageModel([
        suggestion({ label: "Requested By", sourceText: "Requested By" }),
      ]);
      const useCase = new SuggestTemplateFields(languageModel);

      const result = await useCase.execute({
        documentText: "Approved By\nJoe Bloggs\n\nRequested By\nJoe Bloggs",
        mode: "filled",
      });

      expect(result.data?.suggestions[0]?.occurrence).toBe(1);
    });

    it("places the placeholder after the caption when the example left it blank", async () => {
      const languageModel = makeLanguageModel([
        suggestion({ label: "Equipment Type", sourceText: "Equipment Type" }),
        suggestion({ label: "Requested By", sourceText: "Joe Bloggs" }),
      ]);
      const useCase = new SuggestTemplateFields(languageModel);

      const result = await useCase.execute({
        documentText: "Equipment Type\n\nRequested By\nJoe Bloggs",
        mode: "filled",
      });

      const equipment = result.data?.suggestions.find((field) => field.label === "Equipment Type");
      expect(equipment?.sourceText).toBe("Equipment Type");
      expect(equipment?.insertAfter).toBe(true);
    });

    it("never treats a run of prose as the value a caption introduces", async () => {
      const prose = `Note ${"a".repeat(200)}`;
      const languageModel = makeLanguageModel([suggestion({ label: "Note", sourceText: "Note" })]);
      const useCase = new SuggestTemplateFields(languageModel);

      const result = await useCase.execute({ documentText: prose, mode: "filled" });

      expect(result.data?.suggestions[0]?.insertAfter).toBe(true);
    });

    it("does not move the anchor onto another field's caption", async () => {
      const languageModel = makeLanguageModel([
        suggestion({ label: "Equipment Type", sourceText: "Equipment Type" }),
      ]);
      const useCase = new SuggestTemplateFields(languageModel);

      const result = await useCase.execute({
        documentText: "Equipment Type\n\nRequested By\nJoe Bloggs",
        mode: "filled",
        existingLabels: ["Requested By"],
      });

      expect(result.data?.suggestions[0]?.sourceText).toBe("Equipment Type");
      expect(result.data?.suggestions[0]?.insertAfter).toBe(true);
    });
  });

  it("anchors a blank template's placeholder after its caption", async () => {
    const languageModel = makeLanguageModel([
      suggestion({ label: "Supplier Name", sourceText: "Supplier Name:" }),
    ]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: "Supplier Name:", mode: "empty" });

    expect(result.data?.suggestions[0]?.sourceText).toBe("Supplier Name:");
    expect(result.data?.suggestions[0]?.insertAfter).toBe(true);
  });

  it("replaces a value span outright rather than inserting after it", async () => {
    const languageModel = makeLanguageModel([suggestion()]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(result.data?.suggestions[0]?.insertAfter).toBe(false);
  });

  it("tells the model the caption is not the value on the filled path", async () => {
    const languageModel = makeLanguageModel([]);
    const useCase = new SuggestTemplateFields(languageModel);

    await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    const prompt = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .prompt as string;
    expect(prompt).toContain("never the question");
  });

  it("tells the model to strip sample values on the filled path", async () => {
    const languageModel = makeLanguageModel([]);
    const useCase = new SuggestTemplateFields(languageModel);

    await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    const prompt = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .prompt as string;
    expect(prompt).toContain("filled-in example");
  });

  it("tells the model to insert placeholders on the empty path", async () => {
    const languageModel = makeLanguageModel([]);
    const useCase = new SuggestTemplateFields(languageModel);

    await useCase.execute({ documentText: "Supplier Name:", mode: "empty" });

    const prompt = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .prompt as string;
    expect(prompt).toContain("blank template");
  });

  it("excludes fields the author already has from the augment pass", async () => {
    const languageModel = makeLanguageModel([]);
    const useCase = new SuggestTemplateFields(languageModel);

    await useCase.execute({
      documentText: DOCUMENT,
      mode: "augment",
      existingLabels: ["Supplier Name"],
    });

    const prompt = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .prompt as string;
    expect(prompt).toContain("Supplier Name");
    expect(prompt).toContain("already");
  });

  it("drops a suggestion duplicating a field the author already has", async () => {
    const languageModel = makeLanguageModel([suggestion({ label: "supplier name" })]);
    const useCase = new SuggestTemplateFields(languageModel);

    const result = await useCase.execute({
      documentText: DOCUMENT,
      mode: "augment",
      existingLabels: ["Supplier Name"],
    });

    expect(result.data?.suggestions).toEqual([]);
  });

  it("uses 'template-field-suggestion' as the call purpose for usage tracking", async () => {
    const languageModel = makeLanguageModel([]);
    const useCase = new SuggestTemplateFields(languageModel);

    await useCase.execute({ documentText: DOCUMENT, mode: "filled" });

    expect(
      (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0][0].purpose,
    ).toBe("template-field-suggestion");
  });
});
