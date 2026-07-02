import { describe, it, expect } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type { ChunkOptions, IChunker, ILogger, Result } from "@rbrasier/domain";
import { FallbackChunker } from "./fallback-chunker";

class StubChunker implements IChunker {
  public receivedOptions: ChunkOptions | undefined;
  constructor(private readonly result: Result<string[]>) {}
  async chunk(_text: string, options?: ChunkOptions): Promise<Result<string[]>> {
    this.receivedOptions = options;
    return this.result;
  }
}

class RecordingLogger implements ILogger {
  public warnings: string[] = [];
  debug(): void {}
  info(): void {}
  warn(message: string): void {
    this.warnings.push(message);
  }
  error(): void {}
  fatal(): void {}
}

describe("FallbackChunker", () => {
  it("returns the primary result when the primary succeeds", async () => {
    const primary = new StubChunker(ok(["semantic chunk"]));
    const fallback = new StubChunker(ok(["window chunk"]));
    const chunker = new FallbackChunker(primary, fallback, new RecordingLogger());

    const result = await chunker.chunk("some text");

    expect(result.data).toEqual(["semantic chunk"]);
  });

  it("passes options through to the primary", async () => {
    const primary = new StubChunker(ok(["a"]));
    const chunker = new FallbackChunker(primary, new StubChunker(ok([])), new RecordingLogger());

    await chunker.chunk("some text", { targetTokens: 100, stripPlaceholders: true });

    expect(primary.receivedOptions).toEqual({ targetTokens: 100, stripPlaceholders: true });
  });

  it("falls back and logs the degradation when the primary fails", async () => {
    const primary = new StubChunker(err(domainError("INFRA_FAILURE", "sidecar down")));
    const fallback = new StubChunker(ok(["window chunk"]));
    const logger = new RecordingLogger();
    const chunker = new FallbackChunker(primary, fallback, logger);

    const result = await chunker.chunk("some text", { stripPlaceholders: true });

    expect(result.data).toEqual(["window chunk"]);
    expect(fallback.receivedOptions).toEqual({ stripPlaceholders: true });
    expect(logger.warnings.length).toBe(1);
  });

  it("returns the fallback error when both chunkers fail", async () => {
    const primary = new StubChunker(err(domainError("INFRA_FAILURE", "sidecar down")));
    const fallback = new StubChunker(err(domainError("INFRA_FAILURE", "also down")));
    const chunker = new FallbackChunker(primary, fallback, new RecordingLogger());

    const result = await chunker.chunk("some text");

    expect(result.data).toBeUndefined();
    expect(result.error?.message).toBe("also down");
  });
});
