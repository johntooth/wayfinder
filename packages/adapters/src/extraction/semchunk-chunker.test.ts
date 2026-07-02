import { describe, it, expect } from "vitest";
import { SemchunkChunker } from "./semchunk-chunker";

type FetchImplementation = typeof fetch;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("SemchunkChunker", () => {
  it("POSTs the text to the sidecar and returns its chunks", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const fetchImplementation: FetchImplementation = async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return jsonResponse({ chunks: ["first thought.", "second thought."] });
    };
    const chunker = new SemchunkChunker(
      { baseUrl: "http://semchunk:8000", timeoutMs: 1000 },
      fetchImplementation,
    );

    const result = await chunker.chunk("first thought. second thought.");

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(["first thought.", "second thought."]);
    expect(requests[0]?.url).toBe("http://semchunk:8000/chunk");
    expect(requests[0]?.body).toEqual({ text: "first thought. second thought." });
  });

  it("maps chunk sizing options onto the sidecar request body", async () => {
    let requestBody: unknown;
    const fetchImplementation: FetchImplementation = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return jsonResponse({ chunks: ["a"] });
    };
    const chunker = new SemchunkChunker(
      { baseUrl: "http://semchunk:8000", timeoutMs: 1000 },
      fetchImplementation,
    );

    await chunker.chunk("some text", { targetTokens: 200, overlapTokens: 20 });

    expect(requestBody).toEqual({ text: "some text", max_tokens: 200, overlap_tokens: 20 });
  });

  it("strips {{ placeholder }} tags before the text leaves the process", async () => {
    let requestBody: { text: string } | undefined;
    const fetchImplementation: FetchImplementation = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as { text: string };
      return jsonResponse({ chunks: ["Dear , hello."] });
    };
    const chunker = new SemchunkChunker(
      { baseUrl: "http://semchunk:8000", timeoutMs: 1000 },
      fetchImplementation,
    );

    await chunker.chunk("Dear {{ client_name }}, hello.", { stripPlaceholders: true });

    expect(requestBody?.text).not.toContain("{{");
    expect(requestBody?.text).not.toContain("client_name");
  });

  it("returns an empty array for blank text without calling the sidecar", async () => {
    let called = false;
    const fetchImplementation: FetchImplementation = async () => {
      called = true;
      return jsonResponse({ chunks: [] });
    };
    const chunker = new SemchunkChunker(
      { baseUrl: "http://semchunk:8000", timeoutMs: 1000 },
      fetchImplementation,
    );

    const result = await chunker.chunk("   \n\n  ");

    expect(result.data).toEqual([]);
    expect(called).toBe(false);
  });

  it("returns an INFRA_FAILURE error when the sidecar responds non-2xx", async () => {
    const fetchImplementation: FetchImplementation = async () =>
      jsonResponse({ detail: "boom" }, 500);
    const chunker = new SemchunkChunker(
      { baseUrl: "http://semchunk:8000", timeoutMs: 1000 },
      fetchImplementation,
    );

    const result = await chunker.chunk("some text");

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("returns an INFRA_FAILURE error when the response body is not {chunks: string[]}", async () => {
    const fetchImplementation: FetchImplementation = async () =>
      jsonResponse({ chunks: "not-an-array" });
    const chunker = new SemchunkChunker(
      { baseUrl: "http://semchunk:8000", timeoutMs: 1000 },
      fetchImplementation,
    );

    const result = await chunker.chunk("some text");

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("returns an INFRA_FAILURE error when the network call rejects", async () => {
    const fetchImplementation: FetchImplementation = async () => {
      throw new TypeError("fetch failed");
    };
    const chunker = new SemchunkChunker(
      { baseUrl: "http://semchunk:8000", timeoutMs: 1000 },
      fetchImplementation,
    );

    const result = await chunker.chunk("some text");

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("aborts and returns an INFRA_FAILURE error when the sidecar exceeds the timeout", async () => {
    const fetchImplementation: FetchImplementation = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const chunker = new SemchunkChunker(
      { baseUrl: "http://semchunk:8000", timeoutMs: 10 },
      fetchImplementation,
    );

    const result = await chunker.chunk("some text");

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toContain("timed out");
  });
});
