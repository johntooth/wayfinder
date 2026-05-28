import { beforeEach, describe, expect, it, vi } from "vitest";

const { openaiFactory, anthropicFactory, mistralFactory, bedrockFactory } = vi.hoisted(() => ({
  openaiFactory: vi.fn((modelId: string) => ({ provider: "openai", modelId })),
  anthropicFactory: vi.fn((modelId: string) => ({ provider: "anthropic", modelId })),
  mistralFactory: vi.fn((modelId: string) => ({ provider: "mistral", modelId })),
  bedrockFactory: vi.fn((modelId: string) => ({ provider: "bedrock", modelId })),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => openaiFactory),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => anthropicFactory),
}));

vi.mock("@ai-sdk/mistral", () => ({
  createMistral: vi.fn(() => mistralFactory),
}));

vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn(() => bedrockFactory),
}));

import { createOpenAI } from "@ai-sdk/openai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { defaultModelFor, resolveModel } from "./providers";

describe("defaultModelFor", () => {
  it("returns gpt-4o-mini for openai", () => {
    expect(defaultModelFor("openai")).toBe("gpt-4o-mini");
  });
});

describe("resolveModel — openai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses gpt-4o-mini as the default model when no model is given", () => {
    resolveModel("openai", undefined, "sk-test");

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(openaiFactory).toHaveBeenCalledWith("gpt-4o-mini");
  });

  it("respects the model argument when provided", () => {
    resolveModel("openai", "gpt-4o", "sk-test");

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(openaiFactory).toHaveBeenCalledWith("gpt-4o");
  });

  it("passes an empty options object when apiKey is null", () => {
    resolveModel("openai", "gpt-4o", null);

    expect(createOpenAI).toHaveBeenCalledWith({});
  });

  it("passes an empty options object when apiKey is undefined", () => {
    resolveModel("openai", "gpt-4o");

    expect(createOpenAI).toHaveBeenCalledWith({});
  });

  it("returns the LanguageModel produced by the openai factory", () => {
    const result = resolveModel("openai", "gpt-4o-mini", "sk-test");

    expect(result).toEqual({ provider: "openai", modelId: "gpt-4o-mini" });
  });
});

describe("defaultModelFor — bedrock", () => {
  it("returns the configured Sonnet 4.5 Bedrock model id", () => {
    expect(defaultModelFor("bedrock")).toBe("anthropic.claude-sonnet-4-5-20250929-v1:0");
  });
});

describe("resolveModel — bedrock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes region + accessKeyId + secretAccessKey to createAmazonBedrock", () => {
    resolveModel("bedrock", "anthropic.claude-haiku-4-5-20251001-v1:0", {
      region: "us-east-1",
      accessKeyId: "AKIA-test",
      secretAccessKey: "secret-test",
    });

    expect(createAmazonBedrock).toHaveBeenCalledWith({
      region: "us-east-1",
      accessKeyId: "AKIA-test",
      secretAccessKey: "secret-test",
    });
    expect(bedrockFactory).toHaveBeenCalledWith("anthropic.claude-haiku-4-5-20251001-v1:0");
  });

  it("falls back to the default Sonnet 4.5 model id when no model is given", () => {
    resolveModel("bedrock", undefined, {
      region: "eu-west-1",
      accessKeyId: "AKIA-eu",
      secretAccessKey: "secret-eu",
    });

    expect(bedrockFactory).toHaveBeenCalledWith("anthropic.claude-sonnet-4-5-20250929-v1:0");
  });

  it("passes an empty options object when credentials are null", () => {
    resolveModel("bedrock", "anthropic.claude-haiku-4-5-20251001-v1:0", null);

    expect(createAmazonBedrock).toHaveBeenCalledWith({});
  });

  it("rejects a string credential value for bedrock — bedrock requires the credential object", () => {
    expect(() =>
      // @ts-expect-error — verifying runtime guard for incorrect credential shape
      resolveModel("bedrock", "anthropic.claude-haiku-4-5-20251001-v1:0", "sk-not-a-bedrock-key"),
    ).toThrow();
  });
});

describe("resolveModel — anthropic/openai/mistral reject bedrock-shaped credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws if a bedrock credential object is passed to openai", () => {
    expect(() =>
      // @ts-expect-error — verifying runtime guard
      resolveModel("openai", "gpt-4o-mini", {
        region: "us-east-1",
        accessKeyId: "AKIA",
        secretAccessKey: "s",
      }),
    ).toThrow();
  });
});
