import { describe, expect, it } from "vitest";
import type { AiConfig } from "@rbrasier/domain";
import { mergeApiKeys } from "./settings";

const stored: AiConfig["apiKeys"] = {
  anthropic: "sk-stored-anthropic",
  openai: null,
  mistral: null,
  bedrock: {
    region: "us-east-1",
    accessKeyId: "AKIA-stored",
    secretAccessKey: "secret-stored",
  },
};

describe("settings router — mergeApiKeys (bedrock)", () => {
  it("keeps the stored bedrock credentials when incoming bedrock is null", () => {
    const merged = mergeApiKeys({ bedrock: null }, stored);

    expect(merged.bedrock).toEqual(stored.bedrock);
  });

  it("keeps the stored bedrock credentials when incoming bedrock is undefined", () => {
    const merged = mergeApiKeys({}, stored);

    expect(merged.bedrock).toEqual(stored.bedrock);
  });

  it("merges per-field: blank fields keep stored values, set fields override", () => {
    const merged = mergeApiKeys(
      {
        bedrock: {
          region: "",
          accessKeyId: "AKIA-rotated",
          secretAccessKey: "",
        },
      },
      stored,
    );

    expect(merged.bedrock).toEqual({
      region: "us-east-1",
      accessKeyId: "AKIA-rotated",
      secretAccessKey: "secret-stored",
    });
  });

  it("replaces all three fields when the client sends a full triplet", () => {
    const merged = mergeApiKeys(
      {
        bedrock: {
          region: "eu-west-1",
          accessKeyId: "AKIA-new",
          secretAccessKey: "secret-new",
        },
      },
      stored,
    );

    expect(merged.bedrock).toEqual({
      region: "eu-west-1",
      accessKeyId: "AKIA-new",
      secretAccessKey: "secret-new",
    });
  });

  it("returns stored credentials unchanged when no field would form a complete triplet", () => {
    const blankStored: AiConfig["apiKeys"] = { ...stored, bedrock: null };
    const merged = mergeApiKeys(
      {
        bedrock: {
          region: "us-east-1",
          accessKeyId: "",
          secretAccessKey: "",
        },
      },
      blankStored,
    );

    expect(merged.bedrock).toBeNull();
  });

  it("does not affect legacy provider keys", () => {
    const merged = mergeApiKeys(
      {
        anthropic: "sk-rotated-anthropic",
        bedrock: null,
      },
      stored,
    );

    expect(merged.anthropic).toBe("sk-rotated-anthropic");
    expect(merged.openai).toBeNull();
    expect(merged.mistral).toBeNull();
    expect(merged.bedrock).toEqual(stored.bedrock);
  });
});
