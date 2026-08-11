import {
  domainError,
  err,
  isErr,
  ok,
  type McpServer,
  type ProviderName,
  type IUsageRepository,
  type Result,
} from "@rbrasier/domain";
import {
  experimental_createMCPClient,
  generateObject,
  generateText,
  type LanguageModelV1,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { buildMcpTransport } from "./ai-sdk-mcp-client";
import { selectAllowedTools, prefixToolName } from "./mcp-tool-prepass";
import { recordTokenUsage } from "../observability/usage-tracking-adapter";
import type { QuotaEnforcer } from "../observability/quota-enforcing-adapter";

// The LLM report assembly loop (architecture §5.1). It drives the redline report
// tool surface (apps/redline-mcp, registered in Wayfinder as an internal
// streamable-http server) to gather provenance-addressed facts, then assembles
// them into a report: an ordered list of sections, each `{ heading, body,
// citations }`, where the model chooses the heading, ordering and connective prose
// but authors no facts. Every load-bearing claim is a **transferred passage** — a
// chunk's text copied byte-identical from the store — or a **financial expression**
// carried as womblex wrote it, each citing the store row it came from.
//
// It lives here, beside mcp-tool-prepass.ts in @rbrasier/adapters, because the
// fork's apps/web depends on this package directly and the loop reuses the same
// AI-SDK MCP tool-loop machinery. Building it fork-side keeps the vendoring seam
// from having to widen — redline serves the tool surface over a URL; the fork
// calls it.
//
// The verbatim rule is the testable core and the reason this lands before the
// export: a transferred passage must be byte-identical to its stored chunk, because
// that byte-identity IS the provenance claim the product makes. It is asserted
// directly by re-fetching every cited chunkId from the store and comparing bytes
// (verifyTransferredPassages), never eyeballed. A quoted fragment is allowed, but
// only as a contiguous substring of the stored chunk, so the comparison still
// holds.

// One transferred passage: a chunk's text (or a contiguous fragment of it), cited
// by the stable chunkId it came from.
export interface TransferredPassage {
  readonly chunkId: string;
  readonly text: string;
}

// One financial expression carried as womblex wrote it — exact value, currency and
// the provenance anchor it resolves back to. Uninterpreted: never totalled or
// converted (architecture §5 invariant 7).
export interface ReportFinancialExpression {
  readonly documentId: string;
  readonly provenanceAnchor: string;
  readonly value: string;
  readonly currency: string;
}

export interface ReportSection {
  readonly heading: string;
  // The model's own connective prose. Not a fact — facts live in the passages and
  // expressions the section cites.
  readonly body: string;
  readonly transferredPassages: readonly TransferredPassage[];
  readonly financialExpressions: readonly ReportFinancialExpression[];
  // A section the assembler could not ground in retrievable data. It carries no
  // passages, and names what it could not reach rather than being written anyway
  // from the model's own knowledge (architecture §5.1).
  readonly unreachable: boolean;
  readonly unreachableNote?: string;
}

export interface AssembledReport {
  // The assembler's own claim about whether an enrichment graph was reachable for
  // this evaluation. A report over an evaluation with no graph loaded carries an
  // explicit unavailability, not a silently thinner report.
  readonly graphAvailable: boolean;
  readonly sections: readonly ReportSection[];
}

// The schema the model fills. Built as a function so it is not shared mutable
// state, and so a test can parse against it without importing zod itself.
export const buildReportSchema = (): z.ZodType<AssembledReport> =>
  z.object({
    graphAvailable: z
      .boolean()
      .describe(
        "Whether an enrichment graph was reachable for this evaluation. Set false when the " +
          "graph tools report graphAvailable: false — do not silently omit sections that would " +
          "have needed it.",
      ),
    sections: z
      .array(
        z.object({
          heading: z.string().min(1).describe("The section heading you choose."),
          body: z
            .string()
            .describe(
              "Your connective prose framing the facts. This is NOT a fact — it never states a " +
                "claim the cited passages and expressions do not carry.",
            ),
          transferredPassages: z
            .array(
              z.object({
                chunkId: z
                  .string()
                  .min(1)
                  .describe("The stable chunk id ({source_hash}:{chunk_index}) this text came from."),
                text: z
                  .string()
                  .min(1)
                  .describe(
                    "The passage, copied byte-identical from the stored chunk. You may quote a " +
                      "contiguous fragment, but never paraphrase, trim mid-word, re-case or re-quote — " +
                      "the text must be a verbatim substring of the stored chunk.",
                  ),
              }),
            )
            .describe("The verbatim passages this section transfers, each citing its chunk."),
          financialExpressions: z
            .array(
              z.object({
                documentId: z.string().min(1),
                provenanceAnchor: z
                  .string()
                  .min(1)
                  .describe("The span's provenance anchor as the money tools returned it."),
                value: z.string().min(1).describe("The exact decimal value, as womblex wrote it."),
                currency: z.string().describe('The resolved currency, or "" when unresolved.'),
              }),
            )
            .describe("Financial expressions carried uninterpreted — never totalled or converted."),
          unreachable: z
            .boolean()
            .describe(
              "True when you could not ground this section in retrievable data. An unreachable " +
                "section carries no passages and names what it could not reach.",
            ),
          unreachableNote: z
            .string()
            .optional()
            .describe("When unreachable, what you could not reach and why."),
        }),
      )
      .describe("The report's sections, in the order they should appear."),
  }) as unknown as z.ZodType<AssembledReport>;

// The store re-fetch the verbatim assertion runs against. A thin projection of
// IChunkStore.fetchChunks: given an evaluation and a chunk id, the stored text, or
// null when the id does not resolve. Kept as its own port so the assembly loop is
// testable against a fake store — the byte-identity core needs no live model or
// MCP server to prove.
export interface ReportChunkVerifier {
  fetchChunkText(evaluationId: string, chunkId: string): Promise<Result<string | null>>;
}

export type PassageFailureReason = "chunk-not-found" | "not-verbatim";

export interface PassageFailure {
  readonly sectionHeading: string;
  readonly chunkId: string;
  readonly reason: PassageFailureReason;
}

export interface VerificationOutcome {
  readonly verifiedPassages: number;
  readonly failures: readonly PassageFailure[];
}

// Re-fetches every cited chunk from the store and asserts each transferred passage
// is byte-identical to it (architecture §5.1). A passage passes when it is a
// contiguous substring of the stored chunk — the whole chunk or an exact fragment
// of it. A reworded, re-cased or trimmed-mid-word passage is not a substring and
// fails; a citation whose chunk does not resolve fails too. A store read error is
// surfaced rather than passed silently, because a verifier that cannot read the
// store cannot make the provenance claim.
export async function verifyTransferredPassages(
  report: AssembledReport,
  verifier: ReportChunkVerifier,
  evaluationId: string,
): Promise<Result<VerificationOutcome>> {
  const failures: PassageFailure[] = [];
  let verifiedPassages = 0;

  for (const section of report.sections) {
    for (const passage of section.transferredPassages) {
      const stored = await verifier.fetchChunkText(evaluationId, passage.chunkId);
      if (isErr(stored)) return err(stored.error);

      if (stored.data === null) {
        failures.push({
          sectionHeading: section.heading,
          chunkId: passage.chunkId,
          reason: "chunk-not-found",
        });
        continue;
      }

      if (!stored.data.includes(passage.text)) {
        failures.push({
          sectionHeading: section.heading,
          chunkId: passage.chunkId,
          reason: "not-verbatim",
        });
        continue;
      }

      verifiedPassages += 1;
    }
  }

  return ok({ verifiedPassages, failures });
}

export interface ReportAssemblyInput {
  readonly model: LanguageModelV1;
  // Provider + model name label the usage record, so the assembly appears in
  // spend/quota reporting like every other model call.
  readonly provider: ProviderName;
  readonly modelName: string;
  // The evaluation the report is assembled over. Every tool read and every
  // verification is scoped to it.
  readonly evaluationId: string;
  // What the specialist wants the report to cover — the framing the assembler
  // shapes its sections around.
  readonly brief: string;
  // The redline report tool servers and the tools allowed on each (deny-by-default,
  // exactly as the pre-pass selects).
  readonly servers: readonly McpServer[];
  readonly allowedToolNamesByServer: Record<string, readonly string[]>;
  // Whole-assembly wall-clock budget. A hung MCP server must not hold a request
  // open indefinitely.
  readonly timeoutMs?: number;
  // Steps the gather loop may take before it must stop calling tools and assemble.
  readonly maxSteps?: number;
  readonly userId?: string | null;
  readonly flowId?: string | null;
  readonly sessionId?: string | null;
}

export interface ReportAssemblyResult {
  readonly report: AssembledReport;
  readonly verification: VerificationOutcome;
}

const DEFAULT_ASSEMBLY_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_STEPS = 12;

const GATHER_SYSTEM = [
  "You assemble a procurement evaluation report for a specialist, over one evaluation's",
  "extracted documents. You have read-only tools that fetch stored chunks, financial",
  "expressions, extraction elements and enrichment-graph relations. There is no similarity",
  "search: work from the ids and anchors you hold, and traverse the graph (entity ->",
  "mentioned_in edge -> chunk) to locate more. Every tool read is verbatim and",
  "provenance-addressed.",
  "",
  "First, gather. Call the tools you need to find the passages and financial expressions",
  "that ground the report, then stop. If a graph tool returns graphAvailable: false, no",
  "enrichment graph is loaded — note that; do not treat it as an empty finding, and do not",
  "invent facts to fill a section you could not reach.",
].join(" ");

const ASSEMBLE_SYSTEM = [
  "Now assemble the report. Produce ordered sections. You choose each heading, the ordering",
  "and the connective prose of the body — but you author no facts. Every load-bearing claim",
  "must be a transferred passage (a chunk's text, copied byte-identical from what a tool",
  "returned, citing its chunkId) or a financial expression (carried exactly as the money",
  "tools returned it). Do NOT paraphrase, trim, re-case or re-quote a passage: it must be a",
  "verbatim substring of the stored chunk, because that byte-identity is the provenance",
  "claim the report makes. A section you could not ground is marked unreachable, carries no",
  "passages, and names what it could not reach — never written anyway. Set graphAvailable",
  "to false if any graph tool reported it so.",
].join(" ");

interface AssembledTools {
  readonly tools: ToolSet;
}

// The report assembly loop. Runs through the same governance building blocks as the
// tool pre-pass: the quota check short-circuits a blocked user before any spend, and
// token usage is recorded so both the gather and the assembly count against caps.
// The gather/assemble split and the schema are unit-tested; live behaviour is a
// staging concern.
export class ReportAssembler {
  constructor(
    private readonly usageRepo: IUsageRepository,
    private readonly quotaEnforcer: QuotaEnforcer,
    private readonly chunkVerifier: ReportChunkVerifier,
  ) {}

  async run(input: ReportAssemblyInput): Promise<Result<ReportAssemblyResult>> {
    const gate = await this.quotaEnforcer.check(input.userId);
    if (gate.error) return err(gate.error);

    const clients: Awaited<ReturnType<typeof experimental_createMCPClient>>[] = [];
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.timeoutMs ?? DEFAULT_ASSEMBLY_TIMEOUT_MS,
    );

    try {
      const assembled = await this.assembleToolset(input, clients);
      if (assembled.error) return err(assembled.error);
      if (Object.keys(assembled.data.tools).length === 0) {
        return err(
          domainError(
            "VALIDATION_FAILED",
            "No report tools resolved; the report assembler has nothing to read.",
          ),
        );
      }

      const gathered = await this.gather(input, assembled.data.tools, controller.signal);
      if (gathered.error) return err(gathered.error);

      const assembledReport = await this.assemble(input, gathered.data, controller.signal);
      if (assembledReport.error) return err(assembledReport.error);

      const verification = await verifyTransferredPassages(
        assembledReport.data,
        this.chunkVerifier,
        input.evaluationId,
      );
      if (verification.error) return err(verification.error);

      return ok({ report: assembledReport.data, verification: verification.data });
    } catch (cause) {
      return err(domainError("AGENT_FAILED", "Report assembly failed.", cause));
    } finally {
      clearTimeout(timeout);
      for (const client of clients) {
        try {
          await client.close();
        } catch {
          // best-effort close
        }
      }
    }
  }

  private async assembleToolset(
    input: ReportAssemblyInput,
    clients: Awaited<ReturnType<typeof experimental_createMCPClient>>[],
  ): Promise<Result<AssembledTools>> {
    const tools: ToolSet = {};
    const takenKeys = new Set<string>();
    for (const server of input.servers) {
      const allowed = input.allowedToolNamesByServer[server.id] ?? [];
      if (allowed.length === 0) continue;
      const client = await experimental_createMCPClient({ transport: buildMcpTransport(server) });
      clients.push(client);
      const serverTools = (await client.tools()) as ToolSet;
      for (const [name, tool] of Object.entries(selectAllowedTools(serverTools, [...allowed]))) {
        const key = uniqueKey(prefixToolName(server.label, name), takenKeys);
        takenKeys.add(key);
        tools[key] = tool;
      }
    }
    return ok({ tools });
  }

  private async gather(
    input: ReportAssemblyInput,
    tools: ToolSet,
    abortSignal: AbortSignal,
  ): Promise<Result<string>> {
    const result = await generateText({
      model: input.model,
      system: GATHER_SYSTEM,
      messages: [{ role: "user", content: this.briefPrompt(input) }],
      tools,
      maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
      abortSignal,
    });

    recordTokenUsage(
      this.usageRepo,
      this.usageLabel(input, "redline-report-gather"),
      {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        systemTokens: 0,
        ...extractCacheTokens(result.providerMetadata as Record<string, unknown> | undefined),
      },
    );

    return ok(result.text.trim());
  }

  private async assemble(
    input: ReportAssemblyInput,
    gathered: string,
    abortSignal: AbortSignal,
  ): Promise<Result<AssembledReport>> {
    const result = await generateObject({
      model: input.model,
      schema: buildReportSchema(),
      schemaName: "ProcurementReport",
      system: ASSEMBLE_SYSTEM,
      messages: [
        { role: "user", content: this.briefPrompt(input) },
        {
          role: "assistant",
          content:
            gathered.length > 0
              ? gathered
              : "I have gathered the tool results needed for the report.",
        },
        {
          role: "user",
          content:
            "Assemble the report now from what you gathered. Cite every passage by its chunkId " +
            "and copy its text byte-identical.",
        },
      ],
      abortSignal,
    });

    recordTokenUsage(
      this.usageRepo,
      this.usageLabel(input, "redline-report-assemble"),
      {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        systemTokens: 0,
        ...extractCacheTokens(result.providerMetadata as Record<string, unknown> | undefined),
      },
    );

    return ok(result.object);
  }

  private briefPrompt(input: ReportAssemblyInput): string {
    return [
      `Evaluation: ${input.evaluationId}`,
      `Every tool read is scoped to this evaluationId — pass it on every call.`,
      "",
      "Brief:",
      input.brief,
    ].join("\n");
  }

  private usageLabel(input: ReportAssemblyInput, purpose: string) {
    return {
      purpose,
      userId: input.userId,
      flowId: input.flowId,
      sessionId: input.sessionId,
      model: input.modelName,
      provider: input.provider,
    };
  }
}

// Guards against two servers whose labels slug to the same prefix, so no assembled
// key is ever overwritten (mirrors the pre-pass rule).
function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

interface AnthropicCacheMeta {
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

const extractCacheTokens = (
  providerMetadata: Record<string, unknown> | undefined,
): { cacheReadTokens: number; cacheWriteTokens: number } => {
  const anthropic = providerMetadata?.["anthropic"] as AnthropicCacheMeta | undefined;
  return {
    cacheReadTokens: anthropic?.cacheReadInputTokens ?? 0,
    cacheWriteTokens: anthropic?.cacheCreationInputTokens ?? 0,
  };
};
