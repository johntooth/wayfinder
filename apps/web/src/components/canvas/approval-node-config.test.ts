import { describe, expect, it } from "vitest";
import type { PriorStepField } from "@rbrasier/domain";
import {
  decodeApprovalSubject,
  describeApprovalSubject,
  decodeChangesRequestedTarget,
  editableReturnSteps,
  encodeApprovalSubject,
  encodeChangesRequestedTarget,
  noEditablePredecessorWarning,
  signatureSlotConflict,
  signatureSlotControl,
  signatureSlotsFor,
  type PriorStep,
} from "./approval-node-config";

const priorField = (
  nodeId: string,
  key: string,
  type: PriorStepField["field"]["type"],
): PriorStepField => ({
  nodeId,
  stepLabel: `1. ${nodeId}`,
  stepNumber: 1,
  stepName: nodeId,
  field: { key, label: key.replace(/_/g, " "), type },
});

const step = (nodeId: string, type: PriorStep["type"]): PriorStep => ({
  nodeId,
  stepLabel: `1. ${nodeId}`,
  type,
});

describe("approval subject encoding", () => {
  it("opens an unconfigured node on the last-completed-step default", () => {
    expect(encodeApprovalSubject(undefined)).toEqual({
      kind: "step",
      nodeId: "",
      instruction: "",
    });
  });

  it("round-trips a named step", () => {
    const encoded = encodeApprovalSubject({ kind: "step", nodeId: "node-draft" });

    expect(encoded.nodeId).toBe("node-draft");
    expect(decodeApprovalSubject(encoded)).toEqual({ kind: "step", nodeId: "node-draft" });
  });

  it("round-trips a custom instruction", () => {
    const encoded = encodeApprovalSubject({ kind: "custom", instruction: "Describe the delegation." });

    expect(encoded).toEqual({ kind: "custom", nodeId: "", instruction: "Describe the delegation." });
    expect(decodeApprovalSubject(encoded)).toEqual({
      kind: "custom",
      instruction: "Describe the delegation.",
    });
  });

  it("stores nothing for the default choice, so the runtime default applies", () => {
    expect(decodeApprovalSubject({ kind: "step", nodeId: "", instruction: "" })).toBeUndefined();
  });

  it("stores nothing for an empty custom instruction rather than an empty subject", () => {
    expect(
      decodeApprovalSubject({ kind: "custom", nodeId: "", instruction: "   " }),
    ).toBeUndefined();
  });
});

describe("changes-requested target encoding", () => {
  it("opens an unconfigured node on the nearest-editable default", () => {
    expect(encodeChangesRequestedTarget(undefined)).toBe("");
    expect(encodeChangesRequestedTarget({ kind: "nearest_editable" })).toBe("");
  });

  it("round-trips a named step", () => {
    expect(encodeChangesRequestedTarget({ kind: "step", nodeId: "node-intake" })).toBe(
      "node-intake",
    );
    expect(decodeChangesRequestedTarget("node-intake")).toEqual({
      kind: "step",
      nodeId: "node-intake",
    });
  });

  it("stores nothing for the default choice", () => {
    expect(decodeChangesRequestedTarget("")).toBeUndefined();
  });
});

describe("editableReturnSteps", () => {
  it("offers only steps an operator can actually change", () => {
    const steps = [
      step("intake", "conversational"),
      step("enrich", "auto"),
      step("approval-a", "approval"),
      step("reminder", "scheduled"),
      step("lookup", "mcp"),
      step("draft", "conversational"),
    ];

    expect(editableReturnSteps(steps).map((each) => each.nodeId)).toEqual(["intake", "draft"]);
  });
});

describe("signature slots", () => {
  const fields = [
    priorField("node-draft", "amount", "currency"),
    priorField("node-draft", "delegate_signature", "signature"),
    priorField("node-draft", "finance_signature", "signature"),
    priorField("node-other", "legal_signature", "signature"),
  ];

  it("lists the subject step's signature fields only", () => {
    expect(signatureSlotsFor(fields, "node-draft").map((slot) => slot.key)).toEqual([
      "delegate_signature",
      "finance_signature",
    ]);
  });

  it("lists nothing when the subject is the last-completed default", () => {
    expect(signatureSlotsFor(fields, "")).toEqual([]);
  });

  it("shows no control when the template declares no signature", () => {
    expect(signatureSlotControl([])).toEqual({ mode: "none" });
  });

  it("binds automatically when there is exactly one, since there is no choice", () => {
    expect(signatureSlotControl([{ key: "delegate_signature", label: "Delegate Signature" }])).toEqual(
      { mode: "auto", key: "delegate_signature" },
    );
  });

  it("asks the author to pick when there are two or more", () => {
    const slots = signatureSlotsFor(fields, "node-draft");

    expect(signatureSlotControl(slots)).toEqual({ mode: "choose", slots });
  });

  it("rejects two approval steps signing the same slot", () => {
    const slots = signatureSlotsFor(fields, "node-draft");

    // Named by its label, so the author sees the slot as it reads in the template.
    expect(
      signatureSlotConflict("delegate_signature", ["delegate_signature"], slots),
    ).toContain("delegate signature");
    expect(signatureSlotConflict("finance_signature", ["delegate_signature"], slots)).toBeNull();
    expect(signatureSlotConflict("", ["delegate_signature"], slots)).toBeNull();
  });
});

describe("describeApprovalSubject", () => {
  it("names the default so an untouched node still says what it approves", () => {
    expect(describeApprovalSubject({})).toBe("Approves the last completed step");
  });

  it("distinguishes a chosen step from a described subject", () => {
    expect(describeApprovalSubject({ approvalSubject: { kind: "step", nodeId: "node-draft" } })).toBe(
      "Approves a chosen step",
    );
    expect(
      describeApprovalSubject({ approvalSubject: { kind: "custom", instruction: "the delegation" } }),
    ).toBe("Approves a described subject");
  });

  it("says when the step also signs the document", () => {
    expect(describeApprovalSubject({ signatureFieldKey: "delegate_signature" })).toContain(
      "signs the document",
    );
  });
});

describe("noEditablePredecessorWarning", () => {
  it("warns at authoring time when nothing earlier can be edited", () => {
    const warning = noEditablePredecessorWarning([step("enrich", "auto")], "");

    expect(warning).toContain("hold the session");
  });

  it("stays quiet when an editable step precedes the approval", () => {
    expect(noEditablePredecessorWarning([step("intake", "conversational")], "")).toBeNull();
  });

  it("stays quiet when the author named a target explicitly", () => {
    expect(noEditablePredecessorWarning([step("enrich", "auto")], "node-enrich")).toBeNull();
  });
});
