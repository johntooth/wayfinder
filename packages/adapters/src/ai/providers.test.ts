import { describe, expect, it } from "vitest";
import { defaultModelFor, resolveModel } from "./providers";

// Groq is OpenAI-compatible at /openai/v1, so it needs no new SDK — only a
// baseURL the OpenAI client was never given. Without that, a Groq key resolved
// through `openai` is sent to api.openai.com and 401s, which is what a redline
// UAT run on a Groq-only key actually hit: seeding calls Wayfinder's governed
// model, not just redline's adjudicator.
describe("groq provider", () => {
  it("is resolvable and carries a Groq default model", () => {
    expect(defaultModelFor("groq")).toBe("openai/gpt-oss-120b");
  });

  it("builds a model without throwing, keyed or not", () => {
    expect(() => resolveModel("groq", undefined, "gsk_test")).not.toThrow();
    expect(() => resolveModel("groq")).not.toThrow();
  });

  it("refuses a credential object — Groq authenticates with a bearer key", () => {
    expect(() =>
      resolveModel("groq", undefined, {
        region: "us-east-1",
        accessKeyId: "a",
        secretAccessKey: "b",
      }),
    ).toThrow(/string API key/);
  });

  it("leaves the other providers' defaults alone", () => {
    expect(defaultModelFor("anthropic")).toBe("claude-sonnet-5");
    expect(defaultModelFor("openai")).toBe("gpt-4o-mini");
  });
});
