"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/trpc/client";

interface DocumentEditHistoryModalProps {
  messageId: string;
}

const formatEditedAt = (isoTimestamp: string): string => {
  const parsed = new Date(isoTimestamp);
  return Number.isNaN(parsed.getTime()) ? isoTimestamp : parsed.toLocaleString();
};

// What an approver changed before signing. The originator was previously told
// only that their document had been edited — the values themselves were
// recorded but never shown, which is the thing they actually need to check
// (ADR-045 §3).
export function DocumentEditHistoryModal({ messageId }: DocumentEditHistoryModalProps) {
  const [open, setOpen] = useState(false);
  const fieldsQuery = trpc.document.getFields.useQuery({ messageId }, { enabled: open });
  const summary = fieldsQuery.data?.editSummary;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show what was changed in this document"
        data-document-edit-history
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[#9b6215] transition-colors hover:bg-[#fdf3e3]"
      >
        <Info className="h-3 w-3" strokeWidth={1.8} />
      </button>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>What changed</DialogTitle>
          <DialogDescription>
            Every manual edit to this document, most recent last.
          </DialogDescription>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody className="max-h-[60vh] overflow-y-auto">
          {fieldsQuery.isLoading ? (
            <p className="text-[13px] text-[#6d6a65]">Loading changes…</p>
          ) : !summary ? (
            <p className="text-[13px] text-[#c2385a]">Could not load this document&apos;s changes.</p>
          ) : (
            <>
              {summary.edits.length === 0 ? (
                <p className="text-[13px] text-[#6d6a65]">
                  No fields have been changed since this document was generated.
                </p>
              ) : (
                summary.edits.map((edit, index) => (
                  <EditEntry key={`${edit.editedAt}-${index}`} edit={edit} position={index + 1} />
                ))
              )}

              {summary.untouched.length > 0 && (
                <div className="border-t border-[#dedad2] pt-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6d6a65]">
                    Unchanged fields
                  </p>
                  <div className="overflow-hidden rounded-[10px] border border-[#dedad2] bg-white">
                    <table className="w-full text-[12.5px]">
                      <tbody>
                        {summary.untouched.map((untouchedField) => (
                          <tr
                            key={untouchedField.key}
                            className="border-b border-[#efede8] last:border-0"
                          >
                            <td className="w-2/5 px-3 py-1.5 align-top font-medium text-[#6d6a65]">
                              {untouchedField.label}
                            </td>
                            <td className="px-3 py-1.5 align-top text-[#1a1814] whitespace-pre-wrap">
                              {untouchedField.value || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

interface EditEntry {
  editedAt: string;
  editedBy: string | null;
  changes: { key: string; label: string; previousValue: string; newValue: string }[];
}

function EditEntry({ edit, position }: { edit: EditEntry; position: number }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6d6a65]">
        Edit {position} · {edit.editedBy ?? "Unknown editor"} · {formatEditedAt(edit.editedAt)}
      </p>
      <div className="space-y-2">
        {edit.changes.map((change) => (
          <div
            key={change.key}
            className="rounded-[9px] border border-[#dedad2] bg-[#faf9f7] p-3"
            data-edit-change={change.key}
          >
            <p className="text-[12px] font-medium text-[#1a1814]">{change.label}</p>
            <del className="mt-1 block text-[12.5px] whitespace-pre-wrap text-[#c2385a]">
              {change.previousValue || "(blank)"}
            </del>
            <ins className="mt-0.5 block text-[12.5px] whitespace-pre-wrap text-[#1a1814] no-underline">
              {change.newValue || "(blank)"}
            </ins>
          </div>
        ))}
      </div>
    </div>
  );
}
