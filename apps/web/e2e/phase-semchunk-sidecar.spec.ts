import { expect, test } from "@playwright/test";

// E2E for the opt-in semchunk sidecar (phase: semchunk-sidecar-and-aws-iac,
// ADR-030).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack with the
// sidecar profile up (`docker compose --profile semchunk up`) — excluded from
// the vitest unit run. The contract under test is the sidecar HTTP API the
// TypeScript SemchunkChunker adapter depends on; the adapter's fallback
// behaviour when this service is absent is covered by unit tests
// (fallback-chunker.test.ts / semchunk-chunker.test.ts).
//
// SEMCHUNK_URL defaults to the local compose mapping.

const SEMCHUNK_URL = process.env.SEMCHUNK_URL ?? "http://localhost:8000";

test.describe("semchunk sidecar contract", () => {
  test("healthz reports ok", async ({ request }) => {
    const response = await request.get(`${SEMCHUNK_URL}/healthz`);

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("chunks long text into multiple string chunks (happy path)", async ({ request }) => {
    const text = `${"First complete thought. ".repeat(120)}\n\n${"Second complete thought. ".repeat(120)}`;

    const response = await request.post(`${SEMCHUNK_URL}/chunk`, {
      data: { text, max_tokens: 200, overlap_tokens: 20 },
    });

    expect(response.status()).toBe(200);
    const { chunks } = (await response.json()) as { chunks: string[] };
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(typeof chunk).toBe("string");
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  test("blank text yields no chunks", async ({ request }) => {
    const response = await request.post(`${SEMCHUNK_URL}/chunk`, {
      data: { text: "   \n\n  " },
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ chunks: [] });
  });

  test("rejects an invalid request (error path visible to the caller)", async ({ request }) => {
    const missingText = await request.post(`${SEMCHUNK_URL}/chunk`, {
      data: { max_tokens: 100 },
    });
    expect(missingText.status()).toBe(422);

    const overlapTooLarge = await request.post(`${SEMCHUNK_URL}/chunk`, {
      data: { text: "hello", max_tokens: 50, overlap_tokens: 50 },
    });
    expect(overlapTooLarge.status()).toBe(422);
  });
});
