import { describe, expect, it } from "vitest";
import { buildCompletedStepData } from "./step-data";

const at = (iso: string) => new Date(iso);

const nodes = [
  { id: "a", name: "Gather requirements", positionX: 0 },
  { id: "b", name: "Draft document", positionX: 100 },
  { id: "c", name: "Review", positionX: 200 },
];
const edges = [
  { fromNodeId: "a", toNodeId: "b" },
  { fromNodeId: "b", toNodeId: "c" },
];

describe("buildCompletedStepData", () => {
  it("returns completed steps in order with completion dates and outputs", () => {
    const result = buildCompletedStepData({
      currentNodeId: "c",
      nodes,
      edges,
      messages: [
        { role: "assistant", stepNodeId: "a", confidence: 95, createdAt: at("2026-01-01T10:00:00Z") },
        { role: "assistant", stepNodeId: "b", confidence: 60, createdAt: at("2026-01-01T11:00:00Z") },
        { role: "assistant", stepNodeId: "b", confidence: 92, createdAt: at("2026-01-01T12:00:00Z") },
      ],
      outputs: [
        {
          nodeId: "b",
          createdAt: at("2026-01-01T12:00:00Z"),
          fields: [{ key: "title", label: "Title", type: "text", value: "Laptop request" }],
        },
      ],
    });

    expect(result.map((step) => step.nodeId)).toEqual(["a", "b"]);
    expect(result[0]).toMatchObject({
      stepName: "Gather requirements",
      stepNumber: 1,
      completedAt: at("2026-01-01T10:00:00Z"),
      fields: [],
    });
    expect(result[1]).toMatchObject({
      stepNumber: 2,
      completedAt: at("2026-01-01T12:00:00Z"),
    });
    expect(result[1]?.fields[0]?.value).toBe("Laptop request");
  });

  it("excludes the current step and any step below the confidence threshold", () => {
    const result = buildCompletedStepData({
      currentNodeId: "b",
      nodes,
      edges,
      messages: [
        { role: "assistant", stepNodeId: "a", confidence: 95, createdAt: at("2026-01-01T10:00:00Z") },
        { role: "assistant", stepNodeId: "b", confidence: 99, createdAt: at("2026-01-01T11:00:00Z") },
        { role: "assistant", stepNodeId: "c", confidence: 40, createdAt: at("2026-01-01T12:00:00Z") },
      ],
      outputs: [],
    });

    expect(result.map((step) => step.nodeId)).toEqual(["a"]);
  });

  it("falls back to 'Untitled step' for a blank step name", () => {
    const result = buildCompletedStepData({
      currentNodeId: null,
      nodes: [{ id: "a", name: "  ", positionX: 0 }],
      edges: [],
      messages: [
        { role: "assistant", stepNodeId: "a", confidence: 95, createdAt: at("2026-01-01T10:00:00Z") },
      ],
      outputs: [],
    });

    expect(result[0]?.stepName).toBe("Untitled step");
  });
});
