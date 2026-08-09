import { describe, expect, it } from "vitest";
import { buildApproverEditMessage } from "./approver-edit-message";

describe("buildApproverEditMessage", () => {
  it("names the editor and what they changed", () => {
    expect(
      buildApproverEditMessage({
        editorName: "Ada Lovelace",
        changedLabels: ["Start date", "Employee name"],
      }),
    ).toBe(
      "Ada Lovelace edited this step before deciding the approval: Start date, Employee name.",
    );
  });

  it("reads correctly for a single field", () => {
    expect(buildApproverEditMessage({ editorName: "Ada", changedLabels: ["Start date"] })).toBe(
      "Ada edited this step before deciding the approval: Start date.",
    );
  });

  it("falls back to a neutral name for a deleted account", () => {
    expect(buildApproverEditMessage({ editorName: null, changedLabels: ["Start date"] })).toBe(
      "The approver edited this step before deciding the approval: Start date.",
    );
  });

  it("returns null when nothing changed, so no announcement is posted", () => {
    expect(buildApproverEditMessage({ editorName: "Ada", changedLabels: [] })).toBeNull();
  });
});
