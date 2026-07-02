import { domainError, err, ok } from "@rbrasier/domain";
import type { ChunkOptions, IChunker, Result } from "@rbrasier/domain";
import { stripTemplatePlaceholders } from "./text-chunker";

export interface SemchunkChunkerConfig {
  baseUrl: string;
  timeoutMs: number;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isTimeout = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");

// HTTP client for the semchunk sidecar (ADR-030). Every failure mode — timeout,
// non-2xx, malformed body, network error — maps to a DomainError result so the
// FallbackChunker can degrade to fixed-window chunking instead of failing the
// indexing pipeline.
export class SemchunkChunker implements IChunker {
  constructor(
    private readonly config: SemchunkChunkerConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async chunk(text: string, options?: ChunkOptions): Promise<Result<string[]>> {
    const outgoingText = options?.stripPlaceholders ? stripTemplatePlaceholders(text) : text;
    if (outgoingText.trim().length === 0) return ok([]);

    const body: Record<string, unknown> = { text: outgoingText };
    if (options?.targetTokens !== undefined) body.max_tokens = options.targetTokens;
    if (options?.overlapTokens !== undefined) body.overlap_tokens = options.overlapTokens;

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.config.baseUrl}/chunk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) {
        return err(
          domainError(
            "INFRA_FAILURE",
            `semchunk sidecar timed out after ${this.config.timeoutMs}ms`,
            error,
          ),
        );
      }
      return err(domainError("INFRA_FAILURE", "semchunk sidecar unreachable", error));
    }

    if (!response.ok) {
      return err(
        domainError("INFRA_FAILURE", `semchunk sidecar responded with HTTP ${response.status}`),
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return err(domainError("INFRA_FAILURE", "semchunk sidecar returned invalid JSON", error));
    }

    const chunks = (payload as { chunks?: unknown }).chunks;
    if (!isStringArray(chunks)) {
      return err(
        domainError("INFRA_FAILURE", "semchunk sidecar response missing chunks: string[]"),
      );
    }
    return ok(chunks);
  }
}
