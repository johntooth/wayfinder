import { beforeEach, describe, expect, it } from "vitest";
import {
  isUnsupportedParameterError,
  noteTemperatureUnsupported,
  resetTemperatureSupportCache,
  supportsTemperature,
} from "./sampling-params";

beforeEach(() => {
  resetTemperatureSupportCache();
});

describe("supportsTemperature", () => {
  it("allows temperature on models that accept it", () => {
    expect(supportsTemperature("anthropic", "claude-3-5-sonnet-20241022")).toBe(true);
    expect(supportsTemperature("openai", "gpt-4o-mini")).toBe(true);
    expect(supportsTemperature("mistral", "mistral-small-latest")).toBe(true);
  });

  it("withholds temperature from the Claude 5 family", () => {
    expect(supportsTemperature("anthropic", "claude-sonnet-5")).toBe(false);
    expect(supportsTemperature("anthropic", "claude-opus-5")).toBe(false);
    expect(supportsTemperature("anthropic", "claude-haiku-5")).toBe(false);
  });

  it("withholds temperature from Claude 5 served through Bedrock", () => {
    expect(supportsTemperature("bedrock", "anthropic.claude-sonnet-5")).toBe(false);
    expect(supportsTemperature("bedrock", "us.anthropic.claude-opus-5-v1:0")).toBe(false);
  });

  it("withholds temperature from OpenAI reasoning models", () => {
    expect(supportsTemperature("openai", "o1-preview")).toBe(false);
    expect(supportsTemperature("openai", "o3-mini")).toBe(false);
    expect(supportsTemperature("openai", "gpt-5")).toBe(false);
    expect(supportsTemperature("openai", "gpt-5-mini")).toBe(false);
  });

  it("is case-insensitive about the model id", () => {
    expect(supportsTemperature("anthropic", "CLAUDE-SONNET-5")).toBe(false);
  });

  it("treats a missing model id as supporting temperature", () => {
    expect(supportsTemperature("anthropic", undefined)).toBe(true);
  });
});

describe("isUnsupportedParameterError", () => {
  it("recognises the Anthropic deprecation message", () => {
    const error = new Error("`temperature` is deprecated for this model.");

    expect(isUnsupportedParameterError(error, "temperature")).toBe(true);
  });

  it("recognises the OpenAI unsupported-parameter message", () => {
    const error = new Error(
      "Unsupported parameter: 'temperature' is not supported with this model.",
    );

    expect(isUnsupportedParameterError(error, "temperature")).toBe(true);
  });

  it("reads the response body as well as the message", () => {
    const error = Object.assign(new Error("Bad request"), {
      responseBody: JSON.stringify({
        error: { message: "Unrecognized request argument supplied: temperature" },
      }),
    });

    expect(isUnsupportedParameterError(error, "temperature")).toBe(true);
  });

  it("ignores unrelated provider failures", () => {
    expect(isUnsupportedParameterError(new Error("overloaded_error"), "temperature")).toBe(false);
    expect(isUnsupportedParameterError(new Error("rate limit exceeded"), "temperature")).toBe(
      false,
    );
  });

  it("does not fire when a different parameter is at fault", () => {
    const error = new Error("Unsupported parameter: 'top_k' is not supported with this model.");

    expect(isUnsupportedParameterError(error, "temperature")).toBe(false);
  });

  it("ignores non-error values", () => {
    expect(isUnsupportedParameterError(null, "temperature")).toBe(false);
    expect(isUnsupportedParameterError("temperature", "temperature")).toBe(false);
  });
});

describe("noteTemperatureUnsupported", () => {
  it("withholds temperature from a model once it has rejected it", () => {
    expect(supportsTemperature("anthropic", "claude-future-9")).toBe(true);

    noteTemperatureUnsupported("anthropic", "claude-future-9");

    expect(supportsTemperature("anthropic", "claude-future-9")).toBe(false);
  });

  it("keeps the discovery scoped to that provider and model", () => {
    noteTemperatureUnsupported("anthropic", "claude-future-9");

    expect(supportsTemperature("anthropic", "claude-3-5-sonnet-20241022")).toBe(true);
    expect(supportsTemperature("openai", "claude-future-9")).toBe(true);
  });
});
