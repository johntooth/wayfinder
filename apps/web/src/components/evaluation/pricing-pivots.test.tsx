// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PivotTableCell, PivotTableView } from "@redline/redline-web";

// The core→DOM binding for the pricing pivots (redline delivery-plan item 3).
// The roll-up and the currency formatting are proven framework-free in
// redline-web's own suite (pricing-pivot.test.ts / pricing-view.test.ts); what
// was untested is that this component renders the PivotTableView it is handed —
// single-axis and cross-tab render different column sets off the same view —
// and asks the core for the axis and measure the selects nominate. The
// Playwright spec (e2e/redline-pricing-pivots.spec.ts) stays the later
// confirmation against a served, populated evaluation.

const { pricingPivotQuery } = vi.hoisted(() => ({ pricingPivotQuery: vi.fn() }));

vi.mock("@/trpc/client", () => ({
  trpc: { evaluation: { pricingPivot: { useQuery: pricingPivotQuery } } },
}));

const { PricingPivots } = await import("./pricing-pivots");

const cell = (display: string, value: number, sampleCount: number): PivotTableCell => ({
  display,
  value,
  sampleCount,
});

const blank = (): PivotTableCell => cell("", 0, 0);

const byVendor = (): PivotTableView => ({
  axis: "brand",
  measure: "sum",
  primaryHeader: "Vendor",
  columnHeaders: [],
  measureHeader: "Total (AUD)",
  rows: [
    { key: "Kevlar Industries", cells: [], total: cell("$12,400.00", 12400, 2) },
    { key: "Redgum Supply", cells: [], total: cell("$980.00", 980, 1) },
  ],
  columnTotals: [],
  grandTotal: cell("$13,380.00", 13380, 3),
  hasNumericData: true,
});

const vendorByRequirement = (): PivotTableView => ({
  axis: "brand-x-requirement",
  measure: "sum",
  primaryHeader: "Vendor",
  columnHeaders: ["REQ-1", "REQ-2"],
  measureHeader: "Total (AUD)",
  rows: [
    {
      key: "Kevlar Industries",
      cells: [cell("$12,400.00", 12400, 1), blank()],
      total: cell("$12,400.00", 12400, 1),
    },
    {
      key: "Redgum Supply",
      cells: [blank(), cell("$980.00", 980, 1)],
      total: cell("$980.00", 980, 1),
    },
  ],
  columnTotals: [cell("$12,400.00", 12400, 1), cell("$980.00", 980, 1)],
  grandTotal: cell("$13,380.00", 13380, 2),
  hasNumericData: true,
});

const unpriced = (): PivotTableView => ({
  ...byVendor(),
  rows: [{ key: "Kevlar Industries", cells: [], total: blank() }],
  grandTotal: blank(),
  hasNumericData: false,
});

let container: HTMLDivElement;
let root: Root;

const mount = async (element: ReactElement) => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
};

const mountPivots = () => mount(<PricingPivots evaluationId="eval-1" />);

const queryAll = (selector: string) => Array.from(container.querySelectorAll(selector));

const textsOf = (selector: string) =>
  queryAll(selector).map((element) => element.textContent?.trim() ?? "");

const rowTexts = () =>
  queryAll('[data-testid="pivot-row"]').map((row) =>
    Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? ""),
  );

const selectLabelled = (label: string): HTMLSelectElement => {
  const match = queryAll("select").find(
    (element) => element.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`No select labelled "${label}"`);
  return match as HTMLSelectElement;
};

const choose = async (label: string, value: string) => {
  const select = selectLabelled(label);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

// React 19 warns on every act() call unless this flag is on the global, and it
// is not part of `typeof globalThis` — hence the cast rather than a plain write.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => {
  pricingPivotQuery.mockReset();
  pricingPivotQuery.mockReturnValue({ data: byVendor(), error: null });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("PricingPivots — a single-axis roll-up", () => {
  it("renders the primary and measure headers, and no per-group columns", async () => {
    await mountPivots();

    expect(textsOf('[data-testid="pivot-table"] thead th')).toEqual(["Vendor", "Total (AUD)"]);
  });

  it("renders a row per group, carrying only the group key and its total", async () => {
    await mountPivots();

    expect(rowTexts()).toEqual([
      ["Kevlar Industries", "$12,400.00"],
      ["Redgum Supply", "$980.00"],
    ]);
  });

  it("renders the grand total in the footer", async () => {
    await mountPivots();

    expect(textsOf('[data-testid="pivot-table"] tfoot td')).toEqual(["Total", "$13,380.00"]);
  });
});

describe("PricingPivots — a cross-tab", () => {
  beforeEach(() => {
    pricingPivotQuery.mockReturnValue({ data: vendorByRequirement(), error: null });
  });

  it("renders a column per secondary group, between the primary and measure headers", async () => {
    await mountPivots();

    expect(textsOf('[data-testid="pivot-table"] thead th')).toEqual([
      "Vendor",
      "REQ-1",
      "REQ-2",
      "Total (AUD)",
    ]);
  });

  it("renders each intersection, showing an empty one as a dash rather than $0.00", async () => {
    await mountPivots();

    expect(rowTexts()).toEqual([
      ["Kevlar Industries", "$12,400.00", "—", "$12,400.00"],
      ["Redgum Supply", "—", "$980.00", "$980.00"],
    ]);
  });

  it("renders a column total per secondary group alongside the grand total", async () => {
    await mountPivots();

    expect(textsOf('[data-testid="pivot-table"] tfoot td')).toEqual([
      "Total",
      "$12,400.00",
      "$980.00",
      "$13,380.00",
    ]);
  });
});

describe("PricingPivots — when there is nothing to roll up", () => {
  it("explains that no response is costed yet instead of rendering a table of dashes", async () => {
    pricingPivotQuery.mockReturnValue({ data: unpriced(), error: null });

    await mountPivots();

    expect(container.querySelector('[data-testid="pivot-table"]')).toBeNull();
    expect(container.textContent).toContain("No priced responses yet");
  });

  it("holds the loading line while the core has not answered", async () => {
    pricingPivotQuery.mockReturnValue({ data: undefined, error: null });

    await mountPivots();

    expect(container.querySelector('[data-testid="pivot-table"]')).toBeNull();
    expect(container.textContent).toContain("Loading pivot…");
  });

  it("surfaces the query error", async () => {
    pricingPivotQuery.mockReturnValue({ data: undefined, error: { message: "not permitted" } });

    await mountPivots();

    expect(container.textContent).toContain("not permitted");
  });
});

describe("PricingPivots — what it asks the core for", () => {
  it("opens on the vendor sum", async () => {
    await mountPivots();

    expect(pricingPivotQuery.mock.lastCall?.[0]).toEqual({
      evaluationId: "eval-1",
      axis: "brand",
      measure: "sum",
    });
  });

  it("offers every axis the pivots support, and re-asks with the chosen one", async () => {
    await mountPivots();

    expect(Array.from(selectLabelled("Pivot axis").options).map((option) => option.value)).toEqual([
      "brand",
      "requirement",
      "brand-x-requirement",
    ]);

    await choose("Pivot axis", "brand-x-requirement");

    expect(pricingPivotQuery.mock.lastCall?.[0].axis).toBe("brand-x-requirement");
  });

  it("re-asks with the chosen measure, keeping the axis", async () => {
    await mountPivots();

    await choose("Pivot measure", "avg");

    expect(pricingPivotQuery.mock.lastCall?.[0]).toEqual({
      evaluationId: "eval-1",
      axis: "brand",
      measure: "avg",
    });
  });
});
