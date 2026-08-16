import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getScriptedLanguageModel } from "./scripted-llm";

// The whole point of this module is a switch that must be off in production and
// on in the E2E stack. Getting it wrong in one direction parks every spec that
// scripts the model; in the other it hands a real deployment a model that
// answers from a script. Both are worth pinning.

const globalForScriptedLlm = globalThis as typeof globalThis & {
  _wayfinder_scripted_llm: unknown;
};

describe("getScriptedLanguageModel", () => {
  const original = { ...process.env };

  beforeEach(() => {
    globalForScriptedLlm._wayfinder_scripted_llm = undefined;
  });

  afterEach(() => {
    process.env = { ...original };
    globalForScriptedLlm._wayfinder_scripted_llm = undefined;
  });

  it("is off when TEST_AUTH_BYPASS is unset — the production case", () => {
    delete process.env.TEST_AUTH_BYPASS;

    expect(getScriptedLanguageModel()).toBeNull();
  });

  it("is off for any value of TEST_AUTH_BYPASS other than the exact string true", () => {
    process.env.TEST_AUTH_BYPASS = "1";

    expect(getScriptedLanguageModel()).toBeNull();
  });

  it("is on when TEST_AUTH_BYPASS=true", () => {
    process.env.TEST_AUTH_BYPASS = "true";
    delete process.env.USE_REAL_AI;

    expect(getScriptedLanguageModel()).not.toBeNull();
  });

  it("stands aside for a real-AI run, so that workflow still hits the provider", () => {
    process.env.TEST_AUTH_BYPASS = "true";
    process.env.USE_REAL_AI = "true";

    expect(getScriptedLanguageModel()).toBeNull();
  });

  it("hands back the same instance every call", () => {
    process.env.TEST_AUTH_BYPASS = "true";
    delete process.env.USE_REAL_AI;

    // A second instance would mean /api/test/ai-script writes a script the
    // container never reads — the failure this globalThis pinning exists to stop.
    expect(getScriptedLanguageModel()).toBe(getScriptedLanguageModel());
  });
});
