import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MockLanguageModelV1 } from "ai/test";
import { ok, type McpServer as McpServerEntity, type Result } from "@rbrasier/domain";
import { ReportAssembler, type ReportChunkVerifier } from "./report-assembler";

// The item's exit test, end to end: an LLM assembles a report over a populated
// evaluation, driving the real report tool surface over streamable HTTP, and every
// transferred passage is asserted byte-identical to the chunk it came from — against
// the store (a ReportChunkVerifier over the same seeded rows), not eyeballed. The
// second case proves the no-graph path: an evaluation with no graph loaded produces
// a report with an explicit unavailability, not a silently thinner one.
//
// The model is a MockLanguageModelV1 (no provider spend in the gate) whose
// doGenerate branches on the call mode: a `regular` call is the gather loop and
// emits a tool call then stops; an `object-*` call is the assembly and returns the
// report JSON. The MCP server is real (the SDK's StreamableHTTPServerTransport over
// node:http), so the tool-loop actually connects, lists and calls a tool.

const EVALUATION_ID = "eval-report-1";
const DOCUMENT_ID = "hashA";

// Chosen to fail a paraphrasing or trimming transfer: leading/trailing whitespace,
// a tab and an em dash all have to survive byte-for-byte.
const VERBATIM_TEXT = "  The Contractor shall provide\tsupport 24/7 — including public holidays.  ";
// A contiguous fragment of the stored chunk — a legitimate quoted transfer.
const VERBATIM_FRAGMENT = "support 24/7 — including public holidays";

// The store the byte-identity assertion re-fetches against. Seeded with exactly the
// text the MCP tool serves, so a passage the model transferred faithfully verifies
// and a reworded one does not.
const storeText: Record<string, string> = { [`${DOCUMENT_ID}:0`]: VERBATIM_TEXT };

const chunkVerifier: ReportChunkVerifier = {
  async fetchChunkText(_evaluationId: string, chunkId: string): Promise<Result<string | null>> {
    return ok(chunkId in storeText ? storeText[chunkId]! : null);
  },
};

// A permissive quota gate — the enforcer's real behaviour is proven in its own
// suite; here it must only not block.
const quotaEnforcer = {
  async check(): Promise<Result<true>> {
    return ok(true as const);
  },
} as unknown as ConstructorParameters<typeof ReportAssembler>[1];

// A no-op usage repository: recordTokenUsage is fire-and-forget, so the report does
// not depend on it, but it must accept a create call without throwing.
const usageRepo = {
  async create() {
    return ok({ id: "usage-1" });
  },
  async summarize() {
    return ok([]);
  },
} as unknown as ConstructorParameters<typeof ReportAssembler>[0];

let serverEntity: McpServerEntity;

// A fresh McpServer + transport per request, exactly as redline's report server
// runs in stateless mode — a single server instance cannot be connected to two
// transports, so reusing one across requests fails on the second call.
const buildReportServer = (): McpServer => {
  const server = new McpServer({ name: "mock-report-tools", version: "0.0.0" });
  server.registerTool(
    "fetch_chunks",
    {
      description: "Exact fetch of stored chunks by id; text is verbatim.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            evaluationId: EVALUATION_ID,
            returned: 1,
            available: 1,
            truncated: false,
            chunks: [{ chunkId: `${DOCUMENT_ID}:0`, text: VERBATIM_TEXT }],
          }),
        },
      ],
    }),
  );
  return server;
};

const startMockReportMcpServer = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const node: Server = createServer((request, response) => {
    const server = buildReportServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => void server.close());
    void server.connect(transport).then(() => transport.handleRequest(request, response));
  });

  await new Promise<void>((resolve) => node.listen(0, "127.0.0.1", resolve));
  const address = node.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise<void>((resolve) => node.close(() => resolve())),
  };
};

let running: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  running = await startMockReportMcpServer();
  serverEntity = {
    id: "redline-report",
    label: "Redline report tools",
    transport: "streamable-http",
    url: running.url,
    credentialRef: null,
    communicatesExternally: false,
    status: "active",
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});

afterAll(async () => {
  await running.close();
});

// The gather turn emits one tool call; on the follow-up turn (the tool result is
// now in the prompt) it stops with text. The assembly turn returns the report JSON.
const modelThatTransfers = (passageText: string): MockLanguageModelV1 =>
  new MockLanguageModelV1({
    defaultObjectGenerationMode: "json",
    doGenerate: async (options) => {
      if (options.mode.type === "regular") {
        const alreadyCalled = options.prompt.some((message) => message.role === "tool");
        if (!alreadyCalled) {
          return {
            finishReason: "tool-calls",
            usage: { promptTokens: 10, completionTokens: 5 },
            rawCall: { rawPrompt: null, rawSettings: {} },
            toolCalls: [
              {
                toolCallType: "function",
                toolCallId: randomUUID(),
                toolName: "Redline_report_tools__fetch_chunks",
                args: JSON.stringify({ evaluationId: EVALUATION_ID, chunkIds: [`${DOCUMENT_ID}:0`] }),
              },
            ],
          };
        }
        return {
          finishReason: "stop",
          usage: { promptTokens: 12, completionTokens: 8 },
          rawCall: { rawPrompt: null, rawSettings: {} },
          text: "Gathered the contractor's support commitment from chunk 0.",
        };
      }

      // Assembly: a single grounded section transferring the passage verbatim.
      return {
        finishReason: "stop",
        usage: { promptTokens: 20, completionTokens: 30 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        text: JSON.stringify({
          graphAvailable: true,
          sections: [
            {
              heading: "Support commitment",
              body: "The vendor commits to continuous support, quoted below.",
              transferredPassages: [{ chunkId: `${DOCUMENT_ID}:0`, text: passageText }],
              financialExpressions: [],
              unreachable: false,
            },
          ],
        }),
      };
    },
  });

const assemblerWith = (model: MockLanguageModelV1) =>
  new ReportAssembler(usageRepo, quotaEnforcer, chunkVerifier).run({
    model,
    provider: "anthropic",
    modelName: "claude-sonnet-5",
    evaluationId: EVALUATION_ID,
    brief: "Summarise the vendor's support commitment.",
    servers: [serverEntity],
    allowedToolNamesByServer: { "redline-report": ["fetch_chunks"] },
  });

describe("the report assembly loop", () => {
  it("assembles a report over a populated evaluation with every passage byte-identical to the store", async () => {
    const result = await assemblerWith(modelThatTransfers(VERBATIM_TEXT));

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.report.sections).toHaveLength(1);
    expect(result.data.report.sections[0]?.transferredPassages[0]?.text).toBe(VERBATIM_TEXT);
    // The provenance claim, asserted against the store rather than eyeballed.
    expect(result.data.verification.verifiedPassages).toBe(1);
    expect(result.data.verification.failures).toEqual([]);
  });

  it("verifies a quoted fragment as a contiguous substring of the stored chunk", async () => {
    const result = await assemblerWith(modelThatTransfers(VERBATIM_FRAGMENT));

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.verification.verifiedPassages).toBe(1);
    expect(result.data.verification.failures).toEqual([]);
  });

  it("catches a reworded passage as a verbatim failure — against the store, not the eye", async () => {
    const result = await assemblerWith(modelThatTransfers("round-the-clock support every day"));

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.verification.verifiedPassages).toBe(0);
    expect(result.data.verification.failures).toHaveLength(1);
    expect(result.data.verification.failures[0]?.reason).toBe("not-verbatim");
  });

  it("returns a reported unavailability, not a thinner report, when no graph is loaded", async () => {
    const model = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async (options) => {
        if (options.mode.type === "regular") {
          // The gather loop calls the graph, gets graphAvailable: false, and stops.
          const alreadyCalled = options.prompt.some((message) => message.role === "tool");
          if (!alreadyCalled) {
            return {
              finishReason: "tool-calls",
              usage: { promptTokens: 10, completionTokens: 5 },
              rawCall: { rawPrompt: null, rawSettings: {} },
              toolCalls: [
                {
                  toolCallType: "function",
                  toolCallId: randomUUID(),
                  toolName: "Redline_report_tools__fetch_chunks",
                  args: JSON.stringify({ evaluationId: EVALUATION_ID, chunkIds: [`${DOCUMENT_ID}:0`] }),
                },
              ],
            };
          }
          return {
            finishReason: "stop",
            usage: { promptTokens: 12, completionTokens: 8 },
            rawCall: { rawPrompt: null, rawSettings: {} },
            text: "No enrichment graph is loaded for this evaluation.",
          };
        }
        return {
          finishReason: "stop",
          usage: { promptTokens: 20, completionTokens: 30 },
          rawCall: { rawPrompt: null, rawSettings: {} },
          text: JSON.stringify({
            graphAvailable: false,
            sections: [
              {
                heading: "Key personnel",
                body: "This section could not be grounded in retrievable data.",
                transferredPassages: [],
                financialExpressions: [],
                unreachable: true,
                unreachableNote:
                  "No enrichment graph is loaded for this evaluation, so the personnel entities could not be located.",
              },
            ],
          }),
        };
      },
    });

    const result = await assemblerWith(model);

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.report.graphAvailable).toBe(false);
    const section = result.data.report.sections[0];
    expect(section?.unreachable).toBe(true);
    expect(section?.unreachableNote).toContain("graph");
    expect(section?.transferredPassages).toEqual([]);
    // Nothing was transferred, so nothing fails verification — the report is honest
    // about what it could not reach rather than inventing it.
    expect(result.data.verification.verifiedPassages).toBe(0);
    expect(result.data.verification.failures).toEqual([]);
  });
});
