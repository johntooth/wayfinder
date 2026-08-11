import { describe, expect, it } from "vitest";
import { ok, type Result } from "@rbrasier/domain";
import {
  buildReportSchema,
  verifyTransferredPassages,
  type AssembledReport,
  type ReportChunkVerifier,
} from "./report-assembler";

// The verbatim rule is the testable core (architecture §5.1): a transferred
// passage must be byte-identical to the chunk it came from, and a quoted fragment
// must be a contiguous substring of the stored chunk. The verification is asserted
// against the store — a fake ReportChunkVerifier here, the real IChunkStore
// through apps/web — not eyeballed, so these tests exercise it directly.

const verifierOf = (chunks: Record<string, string | null>): ReportChunkVerifier => ({
  async fetchChunkText(_evaluationId: string, chunkId: string): Promise<Result<string | null>> {
    return ok(chunkId in chunks ? chunks[chunkId]! : null);
  },
});

const reportWith = (
  sections: AssembledReport["sections"],
  graphAvailable = true,
): AssembledReport => ({ graphAvailable, sections });

describe("buildReportSchema", () => {
  it("accepts a section grounded by a transferred passage with a citation", () => {
    const parsed = buildReportSchema().safeParse({
      graphAvailable: true,
      sections: [
        {
          heading: "Delivery approach",
          body: "The vendor proposes a phased rollout.",
          transferredPassages: [{ chunkId: "hashA:2", text: "phased rollout over six months" }],
          financialExpressions: [],
          unreachable: false,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an unreachable section that grounds nothing but names what it could not reach", () => {
    const parsed = buildReportSchema().safeParse({
      graphAvailable: false,
      sections: [
        {
          heading: "Security posture",
          body: "No supporting passages could be retrieved for this section.",
          transferredPassages: [],
          financialExpressions: [],
          unreachable: true,
          unreachableNote: "No enrichment graph is loaded, so security entities could not be located.",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("verifyTransferredPassages", () => {
  const evaluationId = "eval-1";

  it("passes when every transferred passage is byte-identical to its stored chunk", async () => {
    const report = reportWith([
      {
        heading: "Support",
        body: "connective prose",
        transferredPassages: [{ chunkId: "hashA:0", text: "24/7 support desk with a one-hour SLA" }],
        financialExpressions: [],
        unreachable: false,
      },
    ]);
    const verifier = verifierOf({ "hashA:0": "24/7 support desk with a one-hour SLA" });

    const result = await verifyTransferredPassages(report, verifier, evaluationId);

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.verifiedPassages).toBe(1);
    expect(result.data.failures).toEqual([]);
  });

  it("passes a quoted fragment that is a contiguous substring of the stored chunk", async () => {
    const report = reportWith([
      {
        heading: "Support",
        body: "prose",
        transferredPassages: [{ chunkId: "hashA:0", text: "one-hour SLA" }],
        financialExpressions: [],
        unreachable: false,
      },
    ]);
    const verifier = verifierOf({ "hashA:0": "24/7 support desk with a one-hour SLA" });

    const result = await verifyTransferredPassages(report, verifier, evaluationId);

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.failures).toEqual([]);
  });

  it("flags a passage the model reworded — it is not a substring of the stored chunk", async () => {
    const report = reportWith([
      {
        heading: "Support",
        body: "prose",
        transferredPassages: [{ chunkId: "hashA:0", text: "round-the-clock help desk" }],
        financialExpressions: [],
        unreachable: false,
      },
    ]);
    const verifier = verifierOf({ "hashA:0": "24/7 support desk with a one-hour SLA" });

    const result = await verifyTransferredPassages(report, verifier, evaluationId);

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.failures).toHaveLength(1);
    expect(result.data.failures[0]?.chunkId).toBe("hashA:0");
    expect(result.data.failures[0]?.reason).toBe("not-verbatim");
  });

  it("flags a passage whose cited chunk does not resolve in the store", async () => {
    const report = reportWith([
      {
        heading: "Support",
        body: "prose",
        transferredPassages: [{ chunkId: "hashA:99", text: "invented text" }],
        financialExpressions: [],
        unreachable: false,
      },
    ]);
    const verifier = verifierOf({ "hashA:0": "real chunk" });

    const result = await verifyTransferredPassages(report, verifier, evaluationId);

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.failures).toHaveLength(1);
    expect(result.data.failures[0]?.reason).toBe("chunk-not-found");
  });

  it("treats a case change as a verbatim failure — bytes must match, not meaning", async () => {
    const report = reportWith([
      {
        heading: "Support",
        body: "prose",
        transferredPassages: [{ chunkId: "hashA:0", text: "SUPPORT DESK" }],
        financialExpressions: [],
        unreachable: false,
      },
    ]);
    const verifier = verifierOf({ "hashA:0": "support desk" });

    const result = await verifyTransferredPassages(report, verifier, evaluationId);

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.failures).toHaveLength(1);
    expect(result.data.failures[0]?.reason).toBe("not-verbatim");
  });

  it("verifies every passage across every section", async () => {
    const report = reportWith([
      {
        heading: "One",
        body: "prose",
        transferredPassages: [{ chunkId: "a:0", text: "alpha" }],
        financialExpressions: [],
        unreachable: false,
      },
      {
        heading: "Two",
        body: "prose",
        transferredPassages: [
          { chunkId: "b:0", text: "beta" },
          { chunkId: "c:0", text: "gamma" },
        ],
        financialExpressions: [],
        unreachable: false,
      },
    ]);
    const verifier = verifierOf({ "a:0": "alpha", "b:0": "beta", "c:0": "delta only" });

    const result = await verifyTransferredPassages(report, verifier, evaluationId);

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.verifiedPassages).toBe(2);
    expect(result.data.failures).toHaveLength(1);
    expect(result.data.failures[0]?.chunkId).toBe("c:0");
  });

  it("has nothing to verify when a report is entirely unreachable sections", async () => {
    const report = reportWith(
      [
        {
          heading: "Missing",
          body: "Could not be grounded.",
          transferredPassages: [],
          financialExpressions: [],
          unreachable: true,
          unreachableNote: "No graph loaded.",
        },
      ],
      false,
    );
    const verifier = verifierOf({});

    const result = await verifyTransferredPassages(report, verifier, evaluationId);

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.verifiedPassages).toBe(0);
    expect(result.data.failures).toEqual([]);
  });

  it("surfaces a store read failure as an error rather than a silent pass", async () => {
    const report = reportWith([
      {
        heading: "Support",
        body: "prose",
        transferredPassages: [{ chunkId: "hashA:0", text: "text" }],
        financialExpressions: [],
        unreachable: false,
      },
    ]);
    const failingVerifier: ReportChunkVerifier = {
      async fetchChunkText() {
        return { error: { code: "INFRA_FAILURE", message: "store down" } };
      },
    };

    const result = await verifyTransferredPassages(report, failingVerifier, evaluationId);

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
