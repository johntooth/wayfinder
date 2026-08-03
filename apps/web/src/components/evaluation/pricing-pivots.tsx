"use client";

import { useState } from "react";
import type { PivotAxis, PivotMeasureKind, PivotTableView } from "@redline/redline-web";
import { trpc } from "@/trpc/client";

// The redline pricing pivots surface (ADR-0019, delivery-plan item 3 step 3):
// the vendor / requirement / vendor × requirement roll-ups of a tender's costed
// responses, summed or averaged. It binds to the framework-free PivotTableView
// the `evaluation.pricingPivot` tRPC procedure returns; the roll-up and the
// currency formatting live in renderPivotView on the server, so this component
// only owns the DOM and the axis/measure request state.

const AXIS_OPTIONS: readonly { value: PivotAxis; label: string }[] = [
  { value: "brand", label: "By vendor" },
  { value: "requirement", label: "By requirement" },
  { value: "brand-x-requirement", label: "Vendor × requirement" },
];

const MEASURE_OPTIONS: readonly { value: PivotMeasureKind; label: string }[] = [
  { value: "sum", label: "Total" },
  { value: "avg", label: "Average" },
];

export interface PricingPivotsProps {
  evaluationId: string;
}

export function PricingPivots({ evaluationId }: PricingPivotsProps) {
  const [axis, setAxis] = useState<PivotAxis>("brand");
  const [measure, setMeasure] = useState<PivotMeasureKind>("sum");

  const pivotQuery = trpc.evaluation.pricingPivot.useQuery({ evaluationId, axis, measure });

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <label className="flex items-center gap-[6px] text-[13px] text-[#5a5650]">
          Pivot
          <select
            value={axis}
            onChange={(event) => setAxis(event.target.value as PivotAxis)}
            aria-label="Pivot axis"
            className="rounded-[7px] border border-[#dedad2] bg-white px-[8px] py-[6px] text-[13px]"
          >
            {AXIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-[6px] text-[13px] text-[#5a5650]">
          Measure
          <select
            value={measure}
            onChange={(event) => setMeasure(event.target.value as PivotMeasureKind)}
            aria-label="Pivot measure"
            className="rounded-[7px] border border-[#dedad2] bg-white px-[8px] py-[6px] text-[13px]"
          >
            {MEASURE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PivotBody
        view={pivotQuery.data}
        errorMessage={pivotQuery.error?.message ?? null}
      />
    </div>
  );
}

function PivotBody({
  view,
  errorMessage,
}: {
  view: PivotTableView | undefined;
  errorMessage: string | null;
}) {
  if (errorMessage) {
    return <p className="text-[13px] text-[#b23b30]">{errorMessage}</p>;
  }
  if (!view) {
    return <p className="text-[13px] text-[#8a857c]">Loading pivot…</p>;
  }
  if (!view.hasNumericData) {
    return (
      <p className="text-[13px] text-[#8a857c]">
        No priced responses yet — pricing figures appear once the extractor lands a
        figure on each response.
      </p>
    );
  }

  // A single-axis pivot's one cell equals the row total, so only a cross-tab
  // (which has secondary-group column headers) renders the per-column cells.
  const isCrossTab = view.columnHeaders.length > 0;

  return (
    <div className="overflow-x-auto rounded-[10px] border border-[#e5e1d8] bg-white">
      <table className="w-full border-collapse text-[13px]" data-testid="pivot-table">
        <thead>
          <tr className="border-b border-[#e5e1d8] text-[11px] uppercase tracking-[0.05em] text-[#6d6a65]">
            <th scope="col" className="px-[12px] py-[8px] text-left">
              {view.primaryHeader}
            </th>
            {view.columnHeaders.map((header) => (
              <th key={header} scope="col" className="px-[12px] py-[8px] text-right">
                {header}
              </th>
            ))}
            <th scope="col" className="px-[12px] py-[8px] text-right">
              {view.measureHeader}
            </th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.key} className="border-b border-[#e5e1d8] hover:bg-[#faf9f6]" data-testid="pivot-row">
              <td className="px-[12px] py-[6px] text-left font-medium text-[#3a352e]">{row.key}</td>
              {isCrossTab
                ? row.cells.map((cell, index) => (
                    <td key={index} className="px-[12px] py-[6px] text-right tabular-nums text-[#3a352e]">
                      {cell.display || <span className="text-[#b6b1a8]">—</span>}
                    </td>
                  ))
                : null}
              <td className="px-[12px] py-[6px] text-right font-semibold tabular-nums text-[#1a1814]">
                {row.total.display || <span className="text-[#b6b1a8]">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[#dedad2] text-[#1a1814]">
            <td className="px-[12px] py-[8px] text-left font-semibold">Total</td>
            {isCrossTab
              ? view.columnTotals.map((cell, index) => (
                  <td key={index} className="px-[12px] py-[8px] text-right font-semibold tabular-nums">
                    {cell.display || <span className="text-[#b6b1a8]">—</span>}
                  </td>
                ))
              : null}
            <td className="px-[12px] py-[8px] text-right font-bold tabular-nums">
              {view.grandTotal.display || <span className="text-[#b6b1a8]">—</span>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
