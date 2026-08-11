import { describe, expect, it } from "vitest";
import { err, ok, domainError, type ChunkRow, type IChunkStore, type Result } from "@redline/redline-domain";
import { ChunkStoreReportVerifier } from "./redline-report-verifier";

// The fork-side ReportChunkVerifier: it re-fetches a single chunk through redline's
// IChunkStore so the assembly loop can assert byte-identity against the store the
// tools read. A resolved id returns its stored text; an unresolved id returns null
// (the transfer cited a chunk that is not there); a store failure propagates.

const chunk = (over: Partial<ChunkRow> & { chunkId: string }): ChunkRow => ({
  documentId: "hashA",
  chunkIndex: 0,
  contentType: "narrative",
  page: 1,
  text: "stored text",
  ...over,
});

class FakeChunkStore implements IChunkStore {
  constructor(private readonly rows: readonly ChunkRow[]) {}
  async fetchChunks(
    _evaluationId: string,
    chunkIds: readonly string[],
  ): Promise<Result<readonly ChunkRow[]>> {
    return ok(chunkIds.flatMap((id) => this.rows.filter((row) => row.chunkId === id)));
  }
  async fetchByStructure(): Promise<Result<readonly ChunkRow[]>> {
    return ok([]);
  }
  async findSimilar(): Promise<Result<never[]>> {
    return err(domainError("NOT_IMPLEMENTED", "deferred"));
  }
}

class FailingChunkStore implements IChunkStore {
  async fetchChunks(): Promise<Result<readonly ChunkRow[]>> {
    return err(domainError("INFRA_FAILURE", "store down"));
  }
  async fetchByStructure(): Promise<Result<readonly ChunkRow[]>> {
    return ok([]);
  }
  async findSimilar(): Promise<Result<never[]>> {
    return err(domainError("NOT_IMPLEMENTED", "deferred"));
  }
}

describe("ChunkStoreReportVerifier", () => {
  it("returns the stored text for a resolved chunk id", async () => {
    const verifier = new ChunkStoreReportVerifier(
      new FakeChunkStore([chunk({ chunkId: "hashA:0", text: "the verbatim passage" })]),
    );

    const result = await verifier.fetchChunkText("eval-1", "hashA:0");

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data).toBe("the verbatim passage");
  });

  it("returns null when the cited chunk does not resolve", async () => {
    const verifier = new ChunkStoreReportVerifier(new FakeChunkStore([]));

    const result = await verifier.fetchChunkText("eval-1", "hashA:99");

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data).toBeNull();
  });

  it("propagates a store read failure so the verifier never claims a false pass", async () => {
    const verifier = new ChunkStoreReportVerifier(new FailingChunkStore());

    const result = await verifier.fetchChunkText("eval-1", "hashA:0");

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
