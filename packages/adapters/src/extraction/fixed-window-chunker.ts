import { ok } from "@rbrasier/domain";
import type { ChunkOptions, IChunker, Result } from "@rbrasier/domain";
import { chunkText } from "./text-chunker";

// The pre-ADR-030 chunker behind the IChunker port: fixed ~500-token windows
// with overlap. Pure and in-process, so it never fails — it is the fallback
// when the semchunk sidecar is unreachable.
export class FixedWindowChunker implements IChunker {
  async chunk(text: string, options?: ChunkOptions): Promise<Result<string[]>> {
    return ok(chunkText(text, options));
  }
}
