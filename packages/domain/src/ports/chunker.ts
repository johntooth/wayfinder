import type { Result } from "../result";

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
  stripPlaceholders?: boolean;
}

// Splits extracted document text into retrieval-sized chunks. Implementations
// must degrade, not throw — a chunking failure is a DomainError result so the
// indexing pipeline can fall back (ADR-030).
export interface IChunker {
  chunk(text: string, options?: ChunkOptions): Promise<Result<string[]>>;
}
