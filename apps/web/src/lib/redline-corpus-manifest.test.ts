import { describe, it, expect } from "vitest";
import { parseCorpusManifest } from "./redline-corpus-manifest";

// The manifest is the operator's half of the corpus run: the served grouping
// page is read-only until the stage machine lands, so vendors, response groups
// and the lens have to come from somewhere the operator controls. This test is
// the manifest's spec — it is hand-written JSON, so every failure has to name
// what is wrong rather than throwing a parse error at someone.

const validManifest = {
  evaluationId: "eval-tender-42",
  evaluationName: "Tender 42 — light fleet",
  lens: {
    lensId: "lens-fleet",
    name: "Fleet procurement",
    topics: [
      { id: "topic-safety", name: "Safety", definition: "Crash-worthiness and ratings." },
      { id: "topic-price", name: "Price", definition: "Whole-of-life cost." },
    ],
    rules: [{ id: "rule-1", pattern: "SEC-*", topicId: "topic-safety" }],
  },
  vendors: [
    { id: "vendor-a", displayName: "Aurora Motors" },
    { id: "vendor-b", displayName: "Borealis Fleet" },
  ],
  groups: [
    { id: "group-a", label: "Aurora response", vendorIds: ["vendor-a"], documentIds: ["docA1", "docA2"] },
    { id: "group-b", label: "Borealis response", vendorIds: ["vendor-b"], documentIds: ["docB1"] },
  ],
};

describe("parseCorpusManifest", () => {
  it("reads a complete manifest", () => {
    const parsed = parseCorpusManifest(validManifest);

    expect(parsed.error).toBeUndefined();
    expect(parsed.data?.evaluationId).toBe("eval-tender-42");
    expect(parsed.data?.lens.topics).toHaveLength(2);
    expect(parsed.data?.groups).toHaveLength(2);
  });

  it("collects every document across the groups, in group order", () => {
    const parsed = parseCorpusManifest(validManifest);

    expect(parsed.data?.documentIds).toEqual(["docA1", "docA2", "docB1"]);
  });

  // A document belongs to exactly one response group — WorkflowManager.assignDocument
  // MOVES a document rather than copying it, so a manifest claiming one document
  // for two groups would silently lose it from the first.
  it("rejects a document claimed by two groups", () => {
    const parsed = parseCorpusManifest({
      ...validManifest,
      groups: [
        { id: "group-a", label: "A", vendorIds: ["vendor-a"], documentIds: ["docA1", "shared"] },
        { id: "group-b", label: "B", vendorIds: ["vendor-b"], documentIds: ["shared", "docB1"] },
      ],
    });

    expect(parsed.error?.code).toBe("VALIDATION_FAILED");
    expect(parsed.error?.message).toContain("shared");
  });

  it("names the missing field rather than throwing", () => {
    const parsed = parseCorpusManifest({ ...validManifest, evaluationId: undefined });

    expect(parsed.error?.code).toBe("VALIDATION_FAILED");
    expect(parsed.error?.message).toContain("evaluationId");
  });

  it("rejects a manifest that is not an object at all", () => {
    const parsed = parseCorpusManifest("[]");

    expect(parsed.error?.code).toBe("VALIDATION_FAILED");
  });

  it("requires at least one group, since an evaluation with no responses builds nothing", () => {
    const parsed = parseCorpusManifest({ ...validManifest, groups: [] });

    expect(parsed.error?.code).toBe("VALIDATION_FAILED");
    expect(parsed.error?.message).toContain("group");
  });

  it("requires every group to carry at least one document", () => {
    const parsed = parseCorpusManifest({
      ...validManifest,
      groups: [{ id: "group-a", label: "A", vendorIds: ["vendor-a"], documentIds: [] }],
    });

    expect(parsed.error?.code).toBe("VALIDATION_FAILED");
    expect(parsed.error?.message).toContain("group-a");
  });

  it("rejects a group referencing a vendor the manifest does not declare", () => {
    const parsed = parseCorpusManifest({
      ...validManifest,
      groups: [
        { id: "group-a", label: "A", vendorIds: ["vendor-ghost"], documentIds: ["docA1"] },
      ],
    });

    expect(parsed.error?.code).toBe("VALIDATION_FAILED");
    expect(parsed.error?.message).toContain("vendor-ghost");
  });

  it("requires the lens to define at least one topic", () => {
    const parsed = parseCorpusManifest({
      ...validManifest,
      lens: { ...validManifest.lens, topics: [], rules: [] },
    });

    expect(parsed.error?.code).toBe("VALIDATION_FAILED");
    expect(parsed.error?.message).toContain("topic");
  });

  it("accepts a lens with no hard rules — every document then adjudicates", () => {
    const parsed = parseCorpusManifest({
      ...validManifest,
      lens: { ...validManifest.lens, rules: [] },
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.data?.lens.rules).toEqual([]);
  });

  // A hard rule matches an identifier token, never prose. A pattern no token can
  // satisfy would silently never fire and fall through to the model, so the
  // parser rejects it here, naming the rule.
  it("rejects a rule whose pattern can match no identifier, naming the rule", () => {
    const parsed = parseCorpusManifest({
      ...validManifest,
      lens: {
        ...validManifest.lens,
        rules: [{ id: "rule-sla", pattern: "service level", topicId: "topic-safety" }],
      },
    });

    expect(parsed.error?.code).toBe("VALIDATION_FAILED");
    expect(parsed.error?.message).toContain("rule-sla");
  });

  it("carries a consortium's members through to the vendor input", () => {
    const parsed = parseCorpusManifest({
      ...validManifest,
      vendors: [
        { id: "vendor-a", displayName: "Aurora Motors" },
        { id: "vendor-b", displayName: "Borealis Fleet" },
        {
          id: "vendor-ab",
          displayName: "Aurora–Borealis consortium",
          isConsortium: true,
          memberVendorIds: ["vendor-a", "vendor-b"],
        },
      ],
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.data?.vendors[2]).toEqual({
      id: "vendor-ab",
      displayName: "Aurora–Borealis consortium",
      isConsortium: true,
      memberVendorIds: ["vendor-a", "vendor-b"],
    });
  });
});
