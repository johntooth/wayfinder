import { ok, err, domainError, type Result } from "@rbrasier/domain";
import type { IChunkStore } from "@redline/redline-domain";

// The fork-side ReportChunkVerifier (architecture §5.1). The report assembly loop
// lives in @rbrasier/adapters and asserts every transferred passage byte-identical
// to its stored chunk; this backs that assertion with redline's own IChunkStore —
// the same store the report tools read — so the byte-comparison is against the
// source, not the model's own claim.
//
// It lives HERE, beside container-redline.ts, rather than in redline-adapters:
// redline's Result/DomainError is its own type, and this maps a redline store read
// onto the @rbrasier/domain Result the assembler expects — the same cross-package
// bridging redline-language-model.ts does for ILanguageModel. redline-adapters can
// reach @rbrasier/domain only through ADR-0012's optional runtime load, which buys
// nothing here since the assembler instance only ever exists in this container.

export class ChunkStoreReportVerifier {
  constructor(private readonly chunkStore: IChunkStore) {}

  // The single-chunk re-fetch the verbatim assertion runs against: the stored text
  // for `chunkId`, or null when the id does not resolve (a citation to a chunk that
  // is not there — a verification failure, not an error). A store read failure
  // crosses as an error rather than a false null, because a verifier that cannot
  // read the store cannot make the provenance claim.
  async fetchChunkText(evaluationId: string, chunkId: string): Promise<Result<string | null>> {
    const fetched = await this.chunkStore.fetchChunks(evaluationId, [chunkId]);
    if (fetched.error) {
      return err(
        domainError("INFRA_FAILURE", `chunk re-fetch failed: ${fetched.error.message}`, fetched.error),
      );
    }
    const row = fetched.data.find((candidate) => candidate.chunkId === chunkId);
    return ok(row ? row.text : null);
  }
}
