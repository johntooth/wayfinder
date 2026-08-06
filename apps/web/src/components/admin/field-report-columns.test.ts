import { describe, expect, it } from "vitest";
import type { FieldReportColumn } from "@rbrasier/domain";
import {
  buildDisplayColumns,
  qualifiedColumnLabel,
  type DisplayColumn,
} from "./field-report-columns";

const column = (overrides: Partial<FieldReportColumn>): FieldReportColumn => ({
  columnKey: "n1:amount",
  nodeId: "n1",
  nodeName: "Intake",
  fieldKey: "amount",
  label: "Amount",
  type: "currency",
  ...overrides,
});

const display = (overrides: Partial<DisplayColumn>): DisplayColumn => ({
  columnKey: "n1:amount",
  nodeId: "n1",
  nodeName: "Intake",
  fieldKey: "amount",
  label: "Amount",
  type: "currency",
  memberKeys: ["n1:amount"],
  stepNames: ["Intake"],
  ...overrides,
});

describe("buildDisplayColumns", () => {
  it("carries the step type through to the display column", () => {
    const columns = buildDisplayColumns(
      [
        column({}),
        column({
          columnKey: "n2:outcome",
          nodeId: "n2",
          nodeName: "Finance Sign-off",
          fieldKey: "outcome",
          label: "Outcome",
          type: "text",
          nodeType: "approval",
        }),
      ],
      true,
      true,
    );

    expect(columns.find((candidate) => candidate.columnKey === "n1:amount")?.nodeType).toBeUndefined();
    expect(columns.find((candidate) => candidate.columnKey === "n2:outcome")?.nodeType).toBe(
      "approval",
    );
  });

  it("keeps two approval steps as two columns", () => {
    // The domain withholds the collapse group ids for approval columns, so
    // nothing here can merge them however the toggles are set.
    const columns = buildDisplayColumns(
      [
        column({
          columnKey: "n1:outcome",
          nodeId: "n1",
          nodeName: "Finance Sign-off",
          fieldKey: "outcome",
          label: "Outcome",
          type: "text",
          nodeType: "approval",
        }),
        column({
          columnKey: "n2:outcome",
          nodeId: "n2",
          nodeName: "Legal Sign-off",
          fieldKey: "outcome",
          label: "Outcome",
          type: "text",
          nodeType: "approval",
        }),
      ],
      true,
      true,
    );

    expect(columns).toHaveLength(2);
  });
});

describe("qualifiedColumnLabel", () => {
  it("names the approval step, so two sign-offs never read alike", () => {
    const finance = display({
      columnKey: "n1:outcome",
      nodeName: "Finance Sign-off",
      label: "Outcome",
      nodeType: "approval",
      stepNames: ["Finance Sign-off"],
    });
    const legal = display({
      columnKey: "n2:outcome",
      nodeName: "Legal Sign-off",
      label: "Outcome",
      nodeType: "approval",
      stepNames: ["Legal Sign-off"],
    });

    expect(qualifiedColumnLabel(finance)).toBe("Finance Sign-off — Outcome");
    expect(qualifiedColumnLabel(legal)).toBe("Legal Sign-off — Outcome");
    expect(qualifiedColumnLabel(finance)).not.toBe(qualifiedColumnLabel(legal));
  });

  it("leaves an ordinary template field alone", () => {
    expect(qualifiedColumnLabel(display({}))).toBe("Amount");
  });

  it("lists the merged steps for a collapsed column", () => {
    const collapsed = display({
      columnKey: "amount",
      memberKeys: ["n1:amount", "n2:amount"],
      stepNames: ["Standard", "Expedited"],
    });

    expect(qualifiedColumnLabel(collapsed)).toBe("Standard · Expedited — Amount");
  });
});
