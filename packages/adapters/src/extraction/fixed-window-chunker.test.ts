import { describe, it, expect } from "vitest";
import { FixedWindowChunker } from "./fixed-window-chunker";
import { chunkText } from "./text-chunker";

describe("FixedWindowChunker", () => {
  it("returns the same chunks as the chunkText utility for plain text", async () => {
    const chunker = new FixedWindowChunker();
    const paragraph = "word ".repeat(400).trim();
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;

    const result = await chunker.chunk(text);

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(chunkText(text));
  });

  it("passes chunk sizing options through to chunkText", async () => {
    const chunker = new FixedWindowChunker();
    const text = "sentence one. ".repeat(200).trim();

    const result = await chunker.chunk(text, { targetTokens: 100, overlapTokens: 10 });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(chunkText(text, { targetTokens: 100, overlapTokens: 10 }));
  });

  it("strips {{ placeholder }} tags when asked", async () => {
    const chunker = new FixedWindowChunker();

    const result = await chunker.chunk("Dear {{ client_name }}, hello.", {
      stripPlaceholders: true,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.join("\n")).not.toContain("{{");
  });

  it("returns an empty array for blank text", async () => {
    const chunker = new FixedWindowChunker();

    const result = await chunker.chunk("   \n\n  ");

    expect(result.data).toEqual([]);
  });
});
