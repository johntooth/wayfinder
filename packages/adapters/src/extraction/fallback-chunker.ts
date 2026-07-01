import type { ChunkOptions, IChunker, ILogger, Result } from "@rbrasier/domain";

// Composite IChunker: tries the primary (semchunk sidecar) and degrades to the
// fallback (fixed-window) on any primary error, so indexing survives a sidecar
// outage (ADR-030). The degradation is logged because silently mixed chunk
// quality is worth an operator's attention.
export class FallbackChunker implements IChunker {
  constructor(
    private readonly primary: IChunker,
    private readonly fallback: IChunker,
    private readonly logger: ILogger,
  ) {}

  async chunk(text: string, options?: ChunkOptions): Promise<Result<string[]>> {
    const primaryResult = await this.primary.chunk(text, options);
    if (primaryResult.error === undefined) return primaryResult;

    this.logger.warn("primary chunker failed — falling back to fixed-window chunking", {
      error: primaryResult.error,
    });
    return this.fallback.chunk(text, options);
  }
}
