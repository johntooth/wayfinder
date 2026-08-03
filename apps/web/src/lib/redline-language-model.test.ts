import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok } from "@redline/redline-domain";
import type { ILanguageModel as WayfinderLanguageModel } from "@rbrasier/domain";
import { RedlineLanguageModelBridge } from "./redline-language-model";

// The redline↔Wayfinder ILanguageModel bridge (delivery-plan §2 item 1). It maps
// redline's summarise() onto Wayfinder's generateText — never generateObject,
// which would demand a schema to carry one paragraph of prose — and it must not
// let a model failure cross redline's port boundary as a throw.

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

interface Recorded {
  purpose?: string;
  prompt?: string;
  system?: string;
}

const modelReturning = (
  text: string,
  recorded: Recorded = {},
): WayfinderLanguageModel =>
  ({
    provider: "openai",
    async generateText(input: { purpose: string; prompt?: string; system?: string }) {
      recorded.purpose = input.purpose;
      recorded.prompt = input.prompt;
      recorded.system = input.system;
      return ok({ text, usage });
    },
  }) as unknown as WayfinderLanguageModel;

const request = {
  vendorName: "Acme",
  productName: "Widget",
  passages: ["24/7 support is included.", "Response within four hours."],
};

describe("RedlineLanguageModelBridge", () => {
  it("maps a summary request onto generateText, carrying a purpose for the usage record", async () => {
    const recorded: Recorded = {};
    const bridge = new RedlineLanguageModelBridge(modelReturning("A summary.", recorded));

    const summary = await bridge.summarise(request);

    expect(isOk(summary)).toBe(true);
    if (!isOk(summary)) return;
    expect(summary.data).toBe("A summary.");
    expect(recorded.purpose).toBe("redline-product-summary");
    expect(recorded.prompt).toContain("Acme");
    expect(recorded.prompt).toContain("24/7 support is included.");
  });

  it("surfaces a model failure as a Result error", async () => {
    const failing = {
      provider: "openai",
      async generateText() {
        return err({ code: "INFRA_FAILURE", message: "upstream 503" });
      },
    } as unknown as WayfinderLanguageModel;

    const summary = await new RedlineLanguageModelBridge(failing).summarise(request);

    expect(isErr(summary)).toBe(true);
    if (!isErr(summary)) return;
    expect(summary.error.code).toBe("INFRA_FAILURE");
    expect(summary.error.message).toContain("upstream 503");
  });

  it("contains a throwing adapter rather than letting it cross the port", async () => {
    const throwing = {
      provider: "openai",
      async generateText(): Promise<never> {
        throw new Error("socket hang up");
      },
    } as unknown as WayfinderLanguageModel;

    const summary = await new RedlineLanguageModelBridge(throwing).summarise(request);

    expect(isErr(summary)).toBe(true);
    if (!isErr(summary)) return;
    expect(summary.error.code).toBe("INFRA_FAILURE");
  });

  it("refuses to summarise with no passages, which would be the model inventing one", async () => {
    const bridge = new RedlineLanguageModelBridge(modelReturning("unused"));

    const summary = await bridge.summarise({ ...request, passages: [] });

    expect(isErr(summary)).toBe(true);
    if (!isErr(summary)) return;
    expect(summary.error.code).toBe("VALIDATION_FAILED");
  });

  it("treats an all-whitespace summary as a failure rather than a valid answer", async () => {
    const bridge = new RedlineLanguageModelBridge(modelReturning("   \n  "));

    const summary = await bridge.summarise(request);

    expect(isErr(summary)).toBe(true);
    if (!isErr(summary)) return;
    expect(summary.error.code).toBe("INFRA_FAILURE");
  });
});
