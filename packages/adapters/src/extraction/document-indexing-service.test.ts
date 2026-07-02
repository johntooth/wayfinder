import { describe, it, expect } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  ChunkOptions,
  DocumentChunkSearch,
  IChunker,
  IDocumentChunkRepository,
  IEmbeddingsProvider,
  NewDocumentChunk,
  Result,
  RetrievedChunk,
} from "@rbrasier/domain";
import { DocumentIndexingService } from "./document-indexing-service";
import { FixedWindowChunker } from "./fixed-window-chunker";

class FakeEmbeddings implements IEmbeddingsProvider {
  public calls: string[] = [];
  constructor(private readonly behaviour: "ok" | "fail" = "ok") {}
  async embed(text: string): Promise<Result<number[]>> {
    this.calls.push(text);
    if (this.behaviour === "fail") {
      return err(domainError("AI_PROVIDER_FAILED", "boom"));
    }
    return ok([text.length, 0, 1]);
  }
}

class FakeChunkRepo implements IDocumentChunkRepository {
  public inserted: NewDocumentChunk[] = [];
  public deletedPaths: string[] = [];
  async insertMany(chunks: NewDocumentChunk[]): Promise<Result<void>> {
    this.inserted.push(...chunks);
    return ok(undefined);
  }
  async deleteByStoragePath(storagePath: string): Promise<Result<void>> {
    this.deletedPaths.push(storagePath);
    return ok(undefined);
  }
  async search(_input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>> {
    return ok([]);
  }
}

const baseInput = {
  flowId: "flow-1",
  sessionId: null,
  sourceType: "flow_context_doc" as const,
  storagePath: "context/flow-1/policy.pdf",
  filename: "policy.pdf",
};

describe("DocumentIndexingService", () => {
  it("deletes existing chunks for the storage path before inserting (re-index safety)", async () => {
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(new FakeEmbeddings(), chunks, new FixedWindowChunker());

    await service.indexDocument({ ...baseInput, text: "A short policy document." });

    expect(chunks.deletedPaths).toEqual(["context/flow-1/policy.pdf"]);
  });

  it("embeds each chunk and inserts them with ascending chunk indexes", async () => {
    const embeddings = new FakeEmbeddings();
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(embeddings, chunks, new FixedWindowChunker());

    const paragraph = "word ".repeat(400).trim();
    const result = await service.indexDocument({
      ...baseInput,
      text: `${paragraph}\n\n${paragraph}\n\n${paragraph}`,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.chunkCount).toBeGreaterThan(1);
    expect(embeddings.calls.length).toBe(chunks.inserted.length);
    chunks.inserted.forEach((chunk, index) => {
      expect(chunk.chunkIndex).toBe(index);
      expect(chunk.flowId).toBe("flow-1");
      expect(chunk.sessionId).toBeNull();
      expect(chunk.embedding).toHaveLength(3);
    });
  });

  it("strips {{ placeholder }} tags from template chunks", async () => {
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(new FakeEmbeddings(), chunks, new FixedWindowChunker());

    await service.indexDocument({
      flowId: "flow-1",
      sessionId: null,
      sourceType: "template",
      storagePath: "templates/node-1/letter.docx",
      filename: "letter.docx",
      text: "Dear {{ client_name }}, your reference is {{ ref }}.",
    });

    const allText = chunks.inserted.map((c) => c.chunkText).join("\n");
    expect(allText).not.toContain("{{");
    expect(allText).not.toContain("client_name");
    expect(allText).toContain("your reference is");
  });

  it("returns the embedding error and inserts nothing when embedding fails", async () => {
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(new FakeEmbeddings("fail"), chunks, new FixedWindowChunker());

    const result = await service.indexDocument({ ...baseInput, text: "Some content." });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(chunks.inserted).toHaveLength(0);
  });

  it("inserts nothing and reports zero chunks for blank text", async () => {
    const embeddings = new FakeEmbeddings();
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(embeddings, chunks, new FixedWindowChunker());

    const result = await service.indexDocument({ ...baseInput, text: "   \n\n  " });

    expect(result.data?.chunkCount).toBe(0);
    expect(embeddings.calls).toHaveLength(0);
    expect(chunks.inserted).toHaveLength(0);
  });

  it("stores exactly the chunks the injected chunker produces", async () => {
    const chunks = new FakeChunkRepo();
    const stubChunker: IChunker = {
      async chunk(): Promise<Result<string[]>> {
        return ok(["a complete thought.", "another complete thought."]);
      },
    };
    const service = new DocumentIndexingService(new FakeEmbeddings(), chunks, stubChunker);

    const result = await service.indexDocument({ ...baseInput, text: "irrelevant" });

    expect(result.data?.chunkCount).toBe(2);
    expect(chunks.inserted.map((chunk) => chunk.chunkText)).toEqual([
      "a complete thought.",
      "another complete thought.",
    ]);
  });

  it("asks the chunker to strip placeholders only for templates", async () => {
    const receivedOptions: (ChunkOptions | undefined)[] = [];
    const stubChunker: IChunker = {
      async chunk(_text: string, options?: ChunkOptions): Promise<Result<string[]>> {
        receivedOptions.push(options);
        return ok(["chunk"]);
      },
    };
    const service = new DocumentIndexingService(
      new FakeEmbeddings(),
      new FakeChunkRepo(),
      stubChunker,
    );

    await service.indexDocument({ ...baseInput, text: "context text" });
    await service.indexDocument({
      ...baseInput,
      sourceType: "template" as const,
      text: "template text",
    });

    expect(receivedOptions[0]?.stripPlaceholders).toBe(false);
    expect(receivedOptions[1]?.stripPlaceholders).toBe(true);
  });

  it("returns the chunker error and inserts nothing when chunking fails", async () => {
    const embeddings = new FakeEmbeddings();
    const chunks = new FakeChunkRepo();
    const failingChunker: IChunker = {
      async chunk(): Promise<Result<string[]>> {
        return err(domainError("INFRA_FAILURE", "chunker down"));
      },
    };
    const service = new DocumentIndexingService(embeddings, chunks, failingChunker);

    const result = await service.indexDocument({ ...baseInput, text: "Some content." });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(embeddings.calls).toHaveLength(0);
    expect(chunks.inserted).toHaveLength(0);
  });
});
