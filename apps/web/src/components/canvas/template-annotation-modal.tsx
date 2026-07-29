"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Info, Loader2, Lock, Sparkles } from "lucide-react";
import { ConfidenceBar } from "@/components/chat/confidence-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AnnotationRow } from "@/lib/template-annotation";
import { FieldConfigModal, FieldRow } from "./field-row";
import {
  lineToModel,
  modelToLine,
  TEMPLATE_TYPE_OPTIONS,
  withType,
  type FieldModel,
  type FieldRowType,
} from "./field-row-model";
import {
  branchFor,
  duplicateCounts,
  isLowConfidence,
  saveBlockedReason,
  toEditableRows,
  validateRow,
  type AnnotationStep,
  type BranchAction,
  type EditableRow,
  type TemplateClassification,
} from "./template-annotation-model";

interface AnalyseResponse {
  filename: string;
  format: "docx" | "xlsx";
  classification: TemplateClassification;
  documentText: string;
  rows: AnnotationRow[];
}

export interface TemplateAnnotationModalProps {
  file: File | null;
  flowId: string;
  nodeId: string;
  // Re-entry: edit the fields of the template already attached to this node,
  // with no file to re-upload.
  existingRows?: AnnotationRow[] | null;
  onCancel: () => void;
  onSaved: (result: {
    path: string;
    filename: string;
    documentTemplateContent: string | null;
    documentTemplateFormat?: "docx" | "xlsx";
    spreadsheetTemplateMode?: "tags" | "header" | null;
  }) => void;
}

const CHEAT_SHEET: { syntax: string; meaning: string }[] = [
  { syntax: "{{ Supplier Name }}", meaning: "A plain text value" },
  { syntax: "{{ Start Date (date) }}", meaning: "A date" },
  { syntax: "{{ Contract Value (currency) }}", meaning: "An amount of money" },
  { syntax: "{{ Contact Email (email) }}", meaning: "An email address" },
  { syntax: "{{ Status (options: Draft, Final) }}", meaning: "One of a fixed set of choices" },
  { syntax: "{{ Notes (maxlen: 200) }}", meaning: "Text with a length limit" },
  { syntax: "{{ Middle Name (optional) }}", meaning: "May be left blank" },
];

export function TemplateAnnotationModal({
  file,
  flowId,
  nodeId,
  existingRows = null,
  onCancel,
  onSaved,
}: TemplateAnnotationModalProps) {
  const isReentry = existingRows !== null;
  const [step, setStep] = useState<AnnotationStep>(isReentry ? "review" : "analysing");
  const [analysis, setAnalysis] = useState<AnalyseResponse | null>(null);
  const [rows, setRows] = useState<EditableRow[]>(() =>
    existingRows ? toEditableRows(existingRows) : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmingPattern, setConfirmingPattern] = useState(false);
  const [configIndex, setConfigIndex] = useState<number | null>(null);
  const [foundNothing, setFoundNothing] = useState(false);
  const analysedRef = useRef(false);

  const templateUrl = `/api/flows/${flowId}/nodes/${nodeId}/template`;

  const save = useCallback(
    async (rowsToSave: EditableRow[]) => {
      setStep("saving");
      setError(null);

      const payloadRows = rowsToSave.map(({ id, confirmed, ...row }) => {
        void id;
        void confirmed;
        return row;
      });

      try {
        const response = isReentry
          ? await fetch(templateUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ annotations: payloadRows }),
            })
          : await (() => {
              const body = new FormData();
              if (file) body.append("file", file);
              body.append("annotations", JSON.stringify(payloadRows));
              return fetch(templateUrl, { method: "POST", body });
            })();

        const payload = (await response.json()) as Parameters<typeof onSaved>[0] & {
          error?: string;
        };
        if (!response.ok) {
          setError(payload.error ?? "Could not save the template.");
          setStep("review");
          return;
        }

        onSaved(payload);
      } catch {
        setError("Could not save the template.");
        setStep("review");
      }
    },
    [file, isReentry, onSaved, templateUrl],
  );

  const analyse = useCallback(async () => {
    if (!file) return;
    setError(null);
    const body = new FormData();
    body.append("file", file);

    try {
      const response = await fetch(`${templateUrl}/analyse`, { method: "POST", body });
      const payload = (await response.json()) as AnalyseResponse & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not read that document.");
        setStep("branch");
        return;
      }

      setAnalysis(payload);
      // An .xlsx already usable in ADR-039 header mode keeps today's behaviour:
      // annotating it would convert it to tag mode and change how it is filled,
      // so it is stored as-is without entering the guided flow.
      if (payload.classification === "header") {
        await save([]);
        return;
      }
      setRows(toEditableRows(payload.rows));
      setStep("branch");
    } catch {
      setError("Could not read that document.");
      setStep("branch");
    }
  }, [file, save, templateUrl]);

  useEffect(() => {
    if (isReentry || analysedRef.current) return;
    analysedRef.current = true;
    void analyse();
  }, [analyse, isReentry]);

  const suggest = async (mode: "empty" | "filled" | "augment") => {
    if (!file || !analysis) return;
    setStep("suggesting");
    setError(null);

    const body = new FormData();
    body.append("file", file);
    body.append("mode", mode);
    body.append(
      "existingLabels",
      JSON.stringify(rows.map((row) => row.line).filter((line) => line.trim())),
    );

    try {
      const response = await fetch(`${templateUrl}/suggest`, { method: "POST", body });
      const payload = (await response.json()) as { rows?: AnnotationRow[]; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The AI could not analyse this document.");
        setStep("review");
        return;
      }

      const suggested = toEditableRows(payload.rows ?? []);
      // Outcome D: never present an empty grid. Say so plainly and leave the
      // author on the manual path, which always works.
      setFoundNothing(suggested.length === 0);
      setRows((current) => [...current, ...suggested]);
      setStep("review");
    } catch {
      setError("The AI could not analyse this document.");
      setStep("review");
    }
  };

  const handleBranch = (action: BranchAction) => {
    if (action === "continue") {
      setStep("review");
      return;
    }
    if (action === "cheatsheet") {
      setStep("cheatsheet");
      return;
    }
    if (action === "augment") {
      void suggest("augment");
      return;
    }
    void suggest(analysis?.classification === "filled" ? "filled" : "empty");
  };

  const updateRow = (index: number, patch: Partial<EditableRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const updateModel = (index: number, patch: Partial<FieldModel>) => {
    const row = rows[index];
    if (!row) return;
    updateRow(index, { line: modelToLine({ ...lineToModel(row.line), ...patch }) });
  };

  const changeType = (index: number, type: FieldRowType) => {
    const row = rows[index];
    if (!row) return;
    updateRow(index, { line: modelToLine(withType(lineToModel(row.line), type)) });
  };

  const removeRow = (index: number) => updateRow(index, { line: "" });

  const duplicates = duplicateCounts(rows);
  const blockedReason = saveBlockedReason(rows);
  const activeConfigRow = configIndex !== null ? rows[configIndex] : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {isReentry ? "Edit template fields" : "Set up your template"}
            {analysis?.filename ? ` — ${analysis.filename}` : ""}
          </DialogTitle>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody>
          {error && (
            <p className="mb-3 rounded-[9px] border border-[#f0c9d4] bg-[#fdeef2] px-3 py-2 text-[12px] text-[#c2385a]">
              {error}
            </p>
          )}

          {step === "analysing" && <Working message="Reading your document…" />}
          {step === "suggesting" && <Working message="Looking for the fields in your document…" />}
          {step === "saving" && <Working message="Saving your template…" />}

          {step === "branch" && analysis && analysis.classification !== "header" && (
            <BranchStep
              classification={analysis.classification}
              confirming={confirmingPattern}
              onConfirmingChange={setConfirmingPattern}
              onChoose={handleBranch}
            />
          )}

          {step === "cheatsheet" && <CheatSheet />}

          {step === "review" && (
            <div className="space-y-3">
              <p className="text-[12px] text-[#6d6a65]">
                Check each field, set its type, and use the cog for choices and limits. The line
                beneath each row is what goes into your document — copy it into Word any time.
              </p>

              {foundNothing && (
                <p className="rounded-[9px] border border-[#e6d9b8] bg-[#fbf6e8] px-3 py-2 text-[12px] text-[#8a6d1f]">
                  The AI did not find any fields it was confident about. Add them yourself below, or
                  mark them up in Word and upload again.
                </p>
              )}

              <div className="space-y-3">
                {rows.map((row, index) => (
                  <ReviewRow
                    key={row.id}
                    row={row}
                    index={index}
                    duplicateCount={duplicates.get(row.key.split(":")[0] ?? row.key) ?? 0}
                    onChangeModel={(patch) => updateModel(index, patch)}
                    onChangeType={(type) => changeType(index, type)}
                    onRemove={() => removeRow(index)}
                    onOpenConfig={() => setConfigIndex(index)}
                    onConfirm={() => updateRow(index, { confirmed: true })}
                    onAcceptCorrection={(line) => updateRow(index, { line })}
                  />
                ))}
              </div>

              <button
                type="button"
                className="text-[12px] text-[#3a5fd9] transition-colors hover:text-[#2e4bb0]"
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    {
                      id: `manual-${current.length}-${Date.now()}`,
                      key: `manual_${current.length}`,
                      kind: "span",
                      line: "",
                      occurrences: [],
                      context: "",
                      originalValue: null,
                      confidence: null,
                      locked: false,
                      confirmed: false,
                    },
                  ])
                }
              >
                + Add a field
              </button>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {blockedReason && step === "review" && (
            <span className="mr-auto text-[12px] text-[#6d6a65]">{blockedReason}</span>
          )}
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          {step === "cheatsheet" && (
            <Button type="button" onClick={onCancel}>
              Done
            </Button>
          )}
          {step === "review" && (
            <Button type="button" disabled={blockedReason !== null} onClick={() => void save(rows)}>
              Save template
            </Button>
          )}
        </DialogFooter>

        {activeConfigRow && configIndex !== null && (
          <FieldConfigModal
            model={lineToModel(activeConfigRow.line)}
            onChange={(patch) => updateModel(configIndex, patch)}
            onClose={() => setConfigIndex(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Working({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#6d6a65]">
      <Loader2 size={16} className="animate-spin" />
      {message}
    </div>
  );
}

function BranchStep({
  classification,
  confirming,
  onConfirmingChange,
  onChoose,
}: {
  classification: Exclude<TemplateClassification, "header">;
  confirming: boolean;
  onConfirmingChange: (value: boolean) => void;
  onChoose: (action: BranchAction) => void;
}) {
  const offer = branchFor(classification);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[14px] font-medium text-[#1a1814]">{offer.title}</p>
        <p className="text-[13px] text-[#5a5650]">{offer.body}</p>
      </div>

      {offer.requiresConfirmation && confirming ? (
        <div className="space-y-3 rounded-[9px] border border-[#e6d9b8] bg-[#fbf6e8] p-3">
          <p className="text-[13px] text-[#8a6d1f]">{offer.confirmationBody}</p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => onChoose(offer.primary)}>
              Yes, use it as a pattern
            </Button>
            <Button type="button" variant="secondary" onClick={() => onConfirmingChange(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() =>
              offer.requiresConfirmation ? onConfirmingChange(true) : onChoose(offer.primary)
            }
          >
            {offer.primary === "continue" ? null : <Sparkles size={13} className="mr-1" />}
            {offer.primaryLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onChoose(offer.secondary)}>
            {offer.secondaryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

function CheatSheet() {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#5a5650]">
        Type these into your document wherever the AI should fill something in, then upload it
        again — the flow picks up where it left off.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#e6e3dc] text-[#6d6a65]">
              <th className="py-1.5 pr-4 font-medium">Type this</th>
              <th className="py-1.5 font-medium">To get</th>
            </tr>
          </thead>
          <tbody>
            {CHEAT_SHEET.map((entry) => (
              <tr key={entry.syntax} className="border-b border-[#f0eee9] last:border-0">
                <td className="py-1.5 pr-4">
                  <code className="font-mono text-[#3a5fd9]">{entry.syntax}</code>
                </td>
                <td className="py-1.5 text-[#5a5650]">{entry.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewRow({
  row,
  index,
  duplicateCount,
  onChangeModel,
  onChangeType,
  onRemove,
  onOpenConfig,
  onConfirm,
  onAcceptCorrection,
}: {
  row: EditableRow;
  index: number;
  duplicateCount: number;
  onChangeModel: (patch: Partial<FieldModel>) => void;
  onChangeType: (type: FieldRowType) => void;
  onRemove: () => void;
  onOpenConfig: () => void;
  onConfirm: () => void;
  onAcceptCorrection: (line: string) => void;
}) {
  const validation = validateRow(row);
  const needsConfirmation = isLowConfidence(row) && !row.confirmed;

  if (row.locked) {
    return (
      <div className="flex items-start gap-2 rounded-[9px] border border-[#e6e3dc] bg-[#f7f6f3] px-3 py-2">
        <Lock size={13} className="mt-0.5 shrink-0 text-[#6d6a65]" />
        <div className="min-w-0 space-y-0.5">
          <code className="block truncate font-mono text-[12px] text-[#5a5650]">
            {`{{${row.line}}}`}
          </code>
          <p className="text-[11px] text-[#6d6a65]">
            An include/repeat block. It is kept exactly as it is — edit it in Word.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`space-y-1.5 rounded-[9px] border p-2.5 ${
        validation.blocking.length > 0
          ? "border-[#f0c9d4] bg-[#fdfafb]"
          : needsConfirmation
            ? "border-[#e6d9b8] bg-[#fdfbf5]"
            : "border-[#e6e3dc]"
      }`}
    >
      <FieldRow
        model={lineToModel(row.line)}
        index={index}
        onChange={onChangeModel}
        onChangeType={onChangeType}
        onRemove={onRemove}
        onOpenConfig={onOpenConfig}
        typeOptions={TEMPLATE_TYPE_OPTIONS}
        labelPlaceholder="e.g. Supplier Name"
      />

      <code className="block truncate font-mono text-[11px] text-[#6d6a65]">
        {row.line.trim() ? `{{ ${row.line.trim()} }}` : "— removed from the document —"}
      </code>

      {row.originalValue && (
        <p className="text-[11px] text-[#5a5650]">
          Replaces <span className="font-medium text-[#1a1814]">{row.originalValue}</span>
        </p>
      )}

      {row.context && (
        <p className="truncate text-[11px] text-[#6d6a65]" title={row.context}>
          {row.context}
        </p>
      )}

      {row.confidence !== null && <ConfidenceBar score={row.confidence} />}

      {validation.blocking.map((message) => (
        <p key={message} className="flex items-start gap-1 text-[11px] text-[#c2385a]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {message}
        </p>
      ))}

      {validation.warnings.map((warning) => (
        <div key={warning.message} className="flex items-start gap-1 text-[11px] text-[#8a6d1f]">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>{warning.message}</span>
          <button
            type="button"
            className="shrink-0 font-medium text-[#3a5fd9] hover:text-[#2e4bb0]"
            onClick={() => onAcceptCorrection(warning.correctedLine)}
          >
            Fix
          </button>
        </div>
      ))}

      {duplicateCount > 1 && (
        <p className="text-[11px] text-[#6d6a65]">
          Asked once, fills {duplicateCount} places in the document.
        </p>
      )}

      {needsConfirmation && (
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] font-medium text-[#8a6d1f] hover:text-[#6d5518]"
          onClick={onConfirm}
        >
          <Check size={12} /> The AI wasn&apos;t sure about this one — confirm it is right
        </button>
      )}
    </div>
  );
}
