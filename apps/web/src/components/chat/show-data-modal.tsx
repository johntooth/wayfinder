"use client";

import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildGroupTable } from "@/lib/group-table";
import { trpc } from "@/trpc/client";

interface ShowDataModalProps {
  open: boolean;
  sessionId: string;
  onClose: () => void;
}

const formatDate = (value: string | Date): string =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function ShowDataModal({ open, sessionId, onClose }: ShowDataModalProps) {
  const stepDataQuery = trpc.session.stepData.useQuery({ sessionId }, { enabled: open });
  const steps = stepDataQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Session data</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="max-h-[70vh] space-y-2 overflow-y-auto">
          {stepDataQuery.isLoading ? (
            <p className="text-[13px] text-[#666055]">Loading…</p>
          ) : steps.length === 0 ? (
            <p className="rounded-[9px] border border-dashed border-[#e7e3db] bg-[#faf9f7] p-4 text-center text-[13px] text-[#666055]">
              No steps have been completed yet.
            </p>
          ) : (
            steps.map((step) => (
              <details
                key={step.nodeId}
                className="group rounded-[9px] border border-[#e7e3db] bg-white"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-[#666055] transition-transform group-open:rotate-90">▶</span>
                    <span className="truncate text-[13px] font-medium text-[#1c1b19]">
                      {step.stepNumber}. {step.stepName}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] text-[#666055]">
                    {formatDate(step.completedAt)}
                  </span>
                </summary>
                <div className="border-t border-[#f0ede8] px-3 py-2.5">
                  {step.fields.length === 0 ? (
                    <p className="text-[12px] text-[#666055]">No data outputs for this step.</p>
                  ) : (
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="text-left text-[#666055]">
                          <th className="border-b border-[#f0ede8] py-1.5 pr-3 font-medium">Field</th>
                          <th className="border-b border-[#f0ede8] py-1.5 font-medium">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {step.fields.map((field) =>
                          field.type === "group" ? (
                            <tr key={field.key} className="align-top">
                              <td colSpan={2} className="border-b border-[#f1efea] py-2">
                                <GroupCell label={field.label} items={field.items ?? []} />
                              </td>
                            </tr>
                          ) : (
                            <tr key={field.key} className="align-top">
                              <td className="border-b border-[#f1efea] py-1.5 pr-3 text-[#5c574c]">
                                {field.label}
                              </td>
                              <td className="border-b border-[#f1efea] py-1.5 whitespace-pre-wrap text-[#1c1b19]">
                                {field.value || "—"}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </details>
            ))
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function GroupCell({ label, items }: { label: string; items: Array<Record<string, string>> }) {
  const table = buildGroupTable(items);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[#5c574c]">{label}</span>
        <span className="text-[11px] text-[#666055]">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>
      {table.columns.length === 0 ? (
        <p className="text-[12px] text-[#666055]">No items.</p>
      ) : (
        <div className="overflow-x-auto rounded-[7px] border border-[#f0ede8]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[#666055]">
                {table.columns.map((column) => (
                  <th
                    key={column.key}
                    className="whitespace-nowrap border-b border-[#f0ede8] bg-[#faf9f7] px-2 py-1.5 font-medium"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="align-top">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={table.columns[cellIndex]!.key}
                      className="whitespace-pre-wrap border-b border-[#f1efea] px-2 py-1.5 text-[#1c1b19] last:border-b-0"
                    >
                      {cell || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
