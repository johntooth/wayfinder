// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReviewCellView, ReviewGridView } from "@redline/redline-web";

// The core→DOM binding for the review grid (redline delivery-plan item 3). The
// sort/filter/link shaping is proven framework-free in redline-web's own suite
// (review-grid.test.ts / review-view.test.ts); what was untested is that this
// component actually renders the ReviewGridView it is handed and hands the
// core back the sort and filter a click produces. The Playwright spec
// (e2e/redline-review-grid.spec.ts) stays the later confirmation against a
// served, populated evaluation — it skips until a real corpus has run.

const { reviewGridQuery, workbookQuery, writeEvaluationWorkbook, toastError } = vi.hoisted(
  () => ({
    reviewGridQuery: vi.fn(),
    workbookQuery: vi.fn(),
    writeEvaluationWorkbook: vi.fn(),
    toastError: vi.fn(),
  }),
);

vi.mock("@/trpc/client", () => ({
  trpc: {
    evaluation: { reviewGrid: { useQuery: reviewGridQuery } },
    useUtils: () => ({ client: { evaluation: { workbook: { query: workbookQuery } } } }),
  },
}));

vi.mock("@redline/redline-web", () => ({ writeEvaluationWorkbook }));

vi.mock("sonner", () => ({ toast: { error: toastError } }));

// next/link prefetches through an IntersectionObserver jsdom does not provide,
// and reaches for the app router context this component is mounted outside of.
// The href it is given is the assertion here, so an anchor is the whole contract.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ReviewTable } = await import("./review-table");

const COLUMN_LABELS = [
  "Vendor",
  "Product",
  "Requirement",
  "Confidence",
  "Summary",
  "Estimate (AUD)",
  "Costing",
  "Source",
];

const cell = (display: string, isNumeric = false): ReviewCellView => ({ display, isNumeric });

const headers = (): ReviewGridView["headers"] => [
  { key: "vendorName", label: "Vendor", sortable: true, activeDirection: null, nextDirection: "asc" },
  { key: "productName", label: "Product", sortable: true, activeDirection: null, nextDirection: "asc" },
  {
    key: "requirementId",
    label: "Requirement",
    sortable: true,
    activeDirection: null,
    nextDirection: "asc",
  },
  {
    key: "confidence",
    label: "Confidence",
    sortable: true,
    activeDirection: null,
    nextDirection: "asc",
  },
  { key: "productSummary", label: "Summary", sortable: true, activeDirection: null, nextDirection: "asc" },
  {
    key: "estimateAud",
    label: "Estimate (AUD)",
    sortable: true,
    activeDirection: null,
    nextDirection: "asc",
  },
  {
    key: "costDescription",
    label: "Costing",
    sortable: true,
    activeDirection: null,
    nextDirection: "asc",
  },
  { key: "source", label: "Source", sortable: false, activeDirection: null, nextDirection: null },
];

const populatedGrid = (): ReviewGridView => ({
  headers: headers(),
  rows: [
    {
      id: "response-1",
      cells: [
        cell("Kevlar Industries"),
        cell("Sentinel 400"),
        cell("REQ-1"),
        cell("0.92", true),
        cell("Ballistic panel rated to NIJ IIIA."),
        cell("$12,400.00", true),
        cell("Per unit, installed"),
        cell(""),
      ],
      source: {
        label: "kevlar-tender.pdf p.4",
        href: "/evaluations/eval-1/documents/doc-1?element=12&page=4&chunk=chunk-9",
      },
    },
    {
      id: "response-2",
      cells: [
        cell("Redgum Supply"),
        cell("Bastion X"),
        cell("REQ-2"),
        cell("0.41", true),
        cell(""),
        cell("$980.00", true),
        cell(""),
        cell(""),
      ],
      source: {
        label: "redgum-tender.pdf p.11",
        href: "/evaluations/eval-1/documents/doc-2?element=3&page=11",
      },
    },
  ],
  requirementFilterOptions: ["REQ-1", "REQ-2"],
  rowCount: 2,
  isEmpty: false,
});

const emptyGrid = (): ReviewGridView => ({
  headers: headers(),
  rows: [],
  requirementFilterOptions: ["REQ-1"],
  rowCount: 0,
  isEmpty: true,
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

const mountGrid = () => mount(<ReviewTable evaluationId="eval-1" evaluationName="Body Armour 2026" />);

const queryAll = (selector: string) => Array.from(container.querySelectorAll(selector));

const textsOf = (selector: string) =>
  queryAll(selector).map((element) => element.textContent?.trim() ?? "");

const rows = () => queryAll('[data-testid="review-row"]');

const cellsOf = (row: Element) => Array.from(row.querySelectorAll("td"));

const rowCellTexts = () =>
  rows().map((row) => cellsOf(row).map((td) => td.textContent?.trim() ?? ""));

const firstRow = (): Element => {
  const [row] = rows();
  if (!row) throw new Error("No review row rendered");
  return row;
};

const buttonNamed = (label: string): HTMLButtonElement => {
  const match = queryAll("button").find((element) => element.getAttribute("aria-label") === label);
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match as HTMLButtonElement;
};

const lastQueryInput = () => reviewGridQuery.mock.lastCall?.[0];

// React 19 warns on every act() call unless this flag is on the global, and it
// is not part of `typeof globalThis` — hence the cast rather than a plain write.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => {
  reviewGridQuery.mockReset();
  workbookQuery.mockReset();
  writeEvaluationWorkbook.mockReset();
  toastError.mockReset();
  reviewGridQuery.mockReturnValue({ data: populatedGrid(), error: null });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("ReviewTable — the columns it renders", () => {
  it("renders one header cell per core column, in the core's order", async () => {
    await mountGrid();

    expect(textsOf('[data-testid="review-table"] thead th')).toEqual(COLUMN_LABELS);
  });

  it("offers a sort control on every sortable column and none on Source", async () => {
    await mountGrid();

    expect(queryAll('[data-testid="review-table"] thead button')).toHaveLength(
      COLUMN_LABELS.length - 1,
    );
    expect(() => buttonNamed("Sort by Source")).toThrow();
  });

  it("shows the active sort direction the core reports, not one it tracks itself", async () => {
    const grid = populatedGrid();
    reviewGridQuery.mockReturnValue({
      data: {
        ...grid,
        headers: grid.headers.map((header) =>
          header.key === "estimateAud"
            ? { ...header, activeDirection: "desc" as const, nextDirection: "asc" as const }
            : header,
        ),
      },
      error: null,
    });

    await mountGrid();

    expect(buttonNamed("Sort by Estimate (AUD)").textContent).toContain("▼");
  });
});

describe("ReviewTable — the rows it renders", () => {
  it("renders a row per core row, with a cell per column", async () => {
    await mountGrid();

    expect(rowCellTexts()).toEqual([
      [
        "Kevlar Industries",
        "Sentinel 400",
        "REQ-1",
        "0.92",
        "Ballistic panel rated to NIJ IIIA.",
        "$12,400.00",
        "Per unit, installed",
        "kevlar-tender.pdf p.4",
      ],
      ["Redgum Supply", "Bastion X", "REQ-2", "0.41", "—", "$980.00", "—", "redgum-tender.pdf p.11"],
    ]);
  });

  it("right-aligns the numeric cells the core flagged, and only those", async () => {
    await mountGrid();

    const alignments = cellsOf(firstRow()).map((td) => td.className.includes("text-right"));

    expect(alignments).toEqual([false, false, false, true, false, true, false, false]);
  });

  it("renders the source column as a deep link to the provenance the core resolved", async () => {
    await mountGrid();

    const links = queryAll('[data-testid="review-source-link"]') as HTMLAnchorElement[];

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/evaluations/eval-1/documents/doc-1?element=12&page=4&chunk=chunk-9",
      "/evaluations/eval-1/documents/doc-2?element=3&page=11",
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      "kevlar-tender.pdf p.4",
      "redgum-tender.pdf p.11",
    ]);
  });

  it("renders the empty state, spanning every column, when the core reports no rows", async () => {
    reviewGridQuery.mockReturnValue({ data: emptyGrid(), error: null });

    await mountGrid();

    expect(rows()).toHaveLength(0);
    const emptyCell = container.querySelector("tbody td");
    expect(emptyCell?.textContent).toBe("No responses match the current filter.");
    expect(emptyCell?.getAttribute("colspan")).toBe(String(COLUMN_LABELS.length));
  });

  it("surfaces the query error instead of an empty grid", async () => {
    reviewGridQuery.mockReturnValue({ data: undefined, error: { message: "not permitted" } });

    await mountGrid();

    expect(container.querySelector('[data-testid="review-table"]')).toBeNull();
    expect(container.textContent).toContain("not permitted");
  });
});

describe("ReviewTable — what it asks the core for", () => {
  it("asks for no sort and no filter until the specialist narrows the grid", async () => {
    await mountGrid();

    expect(lastQueryInput()).toEqual({
      evaluationId: "eval-1",
      sort: undefined,
      filter: undefined,
    });
  });

  it("re-asks with the direction the clicked header nominated", async () => {
    await mountGrid();

    await act(async () => {
      buttonNamed("Sort by Estimate (AUD)").click();
    });

    expect(lastQueryInput()?.sort).toEqual({ key: "estimateAud", direction: "asc" });
  });

  it("offers every requirement the core listed, and re-asks with the chosen one", async () => {
    await mountGrid();

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "REQ-1", "REQ-2"]);

    await act(async () => {
      select.value = "REQ-2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(lastQueryInput()?.filter).toEqual({ requirementId: "REQ-2" });
  });
});

describe("ReviewTable — the export", () => {
  it("writes the workbook the server built, under the evaluation's name", async () => {
    const workbook = { sheets: [{ name: "Review", data: [] }] };
    workbookQuery.mockResolvedValue(workbook);

    await mountGrid();
    await act(async () => {
      (container.querySelector("button:not([aria-label])") as HTMLButtonElement).click();
    });

    expect(workbookQuery).toHaveBeenCalledWith({ evaluationId: "eval-1" });
    expect(writeEvaluationWorkbook).toHaveBeenCalledWith({
      evaluationName: "Body Armour 2026",
      workbook,
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reports a failed export rather than leaving the button spinning", async () => {
    workbookQuery.mockRejectedValue(new Error("workbook unavailable"));

    await mountGrid();
    const exportButton = container.querySelector("button:not([aria-label])") as HTMLButtonElement;
    await act(async () => {
      exportButton.click();
    });

    expect(toastError).toHaveBeenCalledWith("workbook unavailable");
    expect(exportButton.disabled).toBe(false);
  });
});
