"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  ReviewCellView,
  ReviewGridView,
  ReviewHeaderView,
} from "@redline/redline-web";
import { writeEvaluationWorkbook } from "@redline/redline-web";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

// The redline review surface (ADR-0019, delivery-plan item 3 step 3): the
// sortable, filterable table of every procurement response for an evaluation,
// with a source deep-link per row and the Excel export. It binds to the
// framework-free ReviewGridView the `evaluation.reviewGrid` tRPC procedure
// returns; the sort/filter shaping lives entirely in renderReviewGridView on the
// server, so this component only owns the DOM and the request state — mirroring
// the extraction feature's ResultGrid.

type SortDirection = "asc" | "desc";
type SortState = { key: ReviewHeaderView["key"]; direction: SortDirection } | null;

const alignClass = (isNumeric: boolean): string =>
  isNumeric ? "text-right tabular-nums" : "text-left";

const directionArrow = (direction: SortDirection | null): string =>
  direction === "asc" ? "▲" : direction === "desc" ? "▼" : "";

function HeaderCell({
  header,
  onSort,
}: {
  header: ReviewHeaderView;
  onSort: (key: ReviewHeaderView["key"], direction: SortDirection) => void;
}) {
  if (!header.sortable) {
    return (
      <th scope="col" className="px-[12px] py-[8px] text-left">
        {header.label}
      </th>
    );
  }
  return (
    <th scope="col" className="px-[12px] py-[8px] text-left">
      <button
        type="button"
        onClick={() => onSort(header.key, header.nextDirection ?? "asc")}
        aria-label={`Sort by ${header.label}`}
        className="flex items-center gap-[4px] font-semibold text-[#3a352e] hover:text-[#1a1814]"
      >
        <span>{header.label}</span>
        <span aria-hidden className="text-[10px] text-[#8a857c]">
          {directionArrow(header.activeDirection)}
        </span>
      </button>
    </th>
  );
}

function BodyCell({ cell }: { cell: ReviewCellView }) {
  return (
    <td className={`px-[12px] py-[6px] align-top text-[#3a352e] ${alignClass(cell.isNumeric)}`}>
      {cell.display || <span className="text-[#b6b1a8]">—</span>}
    </td>
  );
}

function SourceCell({ href, label }: { href: string; label: string }) {
  return (
    <td className="px-[12px] py-[6px] align-top">
      <Link href={href} className="text-[#3a5fd9] hover:underline" data-testid="review-source-link">
        {label}
      </Link>
    </td>
  );
}

export interface ReviewTableProps {
  evaluationId: string;
  evaluationName: string;
}

export function ReviewTable({ evaluationId, evaluationName }: ReviewTableProps) {
  const [sort, setSort] = useState<SortState>(null);
  const [query, setQuery] = useState("");
  const [requirementId, setRequirementId] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  const utils = trpc.useUtils();
  const gridQuery = trpc.evaluation.reviewGrid.useQuery({
    evaluationId,
    sort: sort ?? undefined,
    filter: filterInput(query, requirementId),
  });

  const onSort = (key: ReviewHeaderView["key"], direction: SortDirection) =>
    setSort({ key, direction });

  // The export workbook is built server-side (the write side stays off the
  // server, the read side off the client): `evaluation.workbook` returns the
  // SheetData; the browser only writes the file via writeEvaluationWorkbook.
  const runExport = async () => {
    setExporting(true);
    try {
      const workbook = await utils.client.evaluation.workbook.query({ evaluationId });
      await writeEvaluationWorkbook({ evaluationName, workbook });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (gridQuery.error) {
    return <p className="text-[13px] text-[#b23b30]">{gridQuery.error.message}</p>;
  }
  const grid: ReviewGridView | undefined = gridQuery.data;
  if (!grid) {
    return <p className="text-[13px] text-[#8a857c]">Loading review…</p>;
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter responses…"
          className="max-w-[240px]"
          aria-label="Filter responses"
        />
        <select
          value={requirementId}
          onChange={(event) => setRequirementId(event.target.value)}
          aria-label="Filter by requirement"
          className="rounded-[7px] border border-[#dedad2] bg-white px-[8px] py-[6px] text-[13px]"
        >
          <option value="">All requirements</option>
          {grid.requirementFilterOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <Button type="button" size="sm" disabled={exporting} onClick={() => void runExport()}>
            {exporting ? "Preparing…" : "Export to Excel"}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-[#e5e1d8] bg-white">
        <table className="w-full border-collapse text-[13px]" data-testid="review-table">
          <thead>
            <tr className="border-b border-[#e5e1d8] text-[11px] uppercase tracking-[0.05em] text-[#6d6a65]">
              {grid.headers.map((header) => (
                <HeaderCell key={header.key} header={header} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[#e5e1d8] hover:bg-[#faf9f6]"
                data-testid="review-row"
              >
                {row.cells.map((cell, index) =>
                  grid.headers[index]?.key === "source" ? (
                    <SourceCell key="source" href={row.source.href} label={row.source.label} />
                  ) : (
                    <BodyCell key={grid.headers[index]?.key ?? index} cell={cell} />
                  ),
                )}
              </tr>
            ))}
            {grid.isEmpty ? (
              <tr>
                <td colSpan={grid.headers.length} className="px-[12px] py-[16px] text-[#8a857c]">
                  No responses match the current filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// An empty filter is undefined so the query key stays stable when nothing is
// filtered — otherwise every keystroke on an empty box would re-key the query.
const filterInput = (
  query: string,
  requirementId: string,
): { query?: string; requirementId?: string } | undefined => {
  const trimmed = query.trim();
  if (!trimmed && !requirementId) return undefined;
  return {
    ...(trimmed ? { query: trimmed } : {}),
    ...(requirementId ? { requirementId } : {}),
  };
};
