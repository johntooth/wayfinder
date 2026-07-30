"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, Check, Download, Info, Loader2, Lock, Sparkles, Upload } from "lucide-react";
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
  rowTypeLabel,
  saveBlockedReason,
  toEditableRows,
  validateRow,
  type AnnotationStep,
  type BranchAction,
  type BranchOffer,
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

const downloadBlob = (file: File): void => {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const downloadFromUrl = (url: string): void => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

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
  // The file currently under review. Held in state (not just the prop) so the
  // author can swap it via the re-upload panel and restart the flow in place.
  const [activeFile, setActiveFile] = useState<File | null>(file);
  const analysedRef = useRef(false);
  const reuploadInputRef = useRef<HTMLInputElement>(null);

  const templateUrl = `/api/flows/${flowId}/nodes/${nodeId}/template`;

  const save = useCallback(
    async (rowsToSave: EditableRow[], fileForSave: File | null) => {
      setStep("saving");
      setError(null);

      const payloadRows = rowsToSave.map(({ id, confirmed, model, ...row }) => {
        void id;
        void confirmed;
        void model;
        return row;
      });

      try {
        // A file present (fresh upload or re-upload) writes a new template via
        // POST; its absence means re-entry editing the stored one via PATCH.
        const response = fileForSave
          ? await (() => {
              const body = new FormData();
              body.append("file", fileForSave);
              body.append("annotations", JSON.stringify(payloadRows));
              return fetch(templateUrl, { method: "POST", body });
            })()
          : await fetch(templateUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ annotations: payloadRows }),
            });

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
    [onSaved, templateUrl],
  );

  const runAnalyse = useCallback(
    async (fileToAnalyse: File) => {
      setStep("analysing");
      setError(null);
      const body = new FormData();
      body.append("file", fileToAnalyse);

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
          await save([], fileToAnalyse);
          return;
        }
        setRows(toEditableRows(payload.rows));
        setStep("branch");
      } catch {
        setError("Could not read that document.");
        setStep("branch");
      }
    },
    [save, templateUrl],
  );

  useEffect(() => {
    if (isReentry || analysedRef.current || !file) return;
    analysedRef.current = true;
    void runAnalyse(file);
  }, [file, isReentry, runAnalyse]);

  const suggest = async (mode: "empty" | "filled" | "augment") => {
    if (!activeFile || !analysis) return;
    setStep("suggesting");
    setError(null);

    const body = new FormData();
    body.append("file", activeFile);
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

  // Model is the source of truth; `line` is recomputed from it so validation and
  // serialisation stay in step while the type survives even with no options yet.
  const setRowModel = (index: number, next: FieldModel) => {
    updateRow(index, { model: next, line: modelToLine(next) });
  };

  const updateModel = (index: number, patch: Partial<FieldModel>) => {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const model = { ...row.model, ...patch };
        return { ...row, model, line: modelToLine(model) };
      }),
    );
  };

  const changeType = (index: number, type: FieldRowType) => {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const model = withType(row.model, type);
        return { ...row, model, line: modelToLine(model) };
      }),
    );
  };

  const acceptCorrection = (index: number, line: string) => {
    updateRow(index, { line, model: lineToModel(line) });
  };

  const removeRow = (index: number) => setRowModel(index, { ...rows[index]!.model, label: "" });

  // Hand the current document back so the author can place more fields in Word,
  // then wait for the edited file. A file in hand (upload or re-upload) is sent
  // straight down; otherwise the stored template is fetched by the GET route.
  const downloadForEditing = () => {
    if (activeFile) {
      downloadBlob(activeFile);
    } else {
      downloadFromUrl(templateUrl);
    }
    setStep("reupload");
  };

  const onReupload = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    if (reuploadInputRef.current) reuploadInputRef.current.value = "";
    if (!next) return;
    setActiveFile(next);
    setAnalysis(null);
    setRows([]);
    setConfirmingPattern(false);
    setFoundNothing(false);
    void runAnalyse(next);
  };

  const duplicates = duplicateCounts(rows);
  const blockedReason = saveBlockedReason(rows);
  const activeConfigRow = configIndex !== null ? rows[configIndex] : null;
  const offer: BranchOffer | null =
    analysis && analysis.classification !== "header" ? branchFor(analysis.classification) : null;

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
          {step === "suggesting" && <Working message="Looking for the data fields in your document…" />}
          {step === "saving" && <Working message="Saving your template…" />}

          {step === "branch" && offer && (
            <BranchBody offer={offer} confirming={confirmingPattern} rows={rows} />
          )}

          {step === "cheatsheet" && <CheatSheet />}

          {step === "reupload" && <ReuploadPanel inputRef={reuploadInputRef} onFile={onReupload} />}

          {step === "review" && (
            <div className="space-y-3">
              <p className="text-[12px] text-[#6d6a65]">
                Check each data field, set its type, and use the cog for choices and limits. The line
                beneath each row is what goes into your document — copy it into Word any time.
              </p>

              {foundNothing && (
                <p className="rounded-[9px] border border-[#e6d9b8] bg-[#fbf6e8] px-3 py-2 text-[12px] text-[#8a6d1f]">
                  The AI did not find any data fields it was confident about. Set them up in Word and
                  upload again.
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
                    onAcceptCorrection={(line) => acceptCorrection(index, line)}
                  />
                ))}
              </div>

              <div className="space-y-2 rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-3">
                <p className="text-[12px] text-[#6d6a65]">
                  Need to add more fields? Download the document to place new data fields into it,
                  using the annotation syntax, then upload it back.
                </p>
                <Button type="button" variant="secondary" onClick={downloadForEditing}>
                  <Download size={13} className="mr-1" /> Download
                </Button>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <div className="mr-auto flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            {step === "review" && blockedReason && (
              <span className="text-[12px] text-[#6d6a65]">{blockedReason}</span>
            )}
          </div>

          {step === "branch" && offer && !confirmingPattern && (
            <>
              <Button type="button" variant="secondary" onClick={() => handleBranch(offer.secondary)}>
                {offer.secondaryLabel}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  offer.requiresConfirmation ? setConfirmingPattern(true) : handleBranch(offer.primary)
                }
              >
                {offer.primary !== "continue" && <Sparkles size={13} className="mr-1" />}
                {offer.primaryLabel}
              </Button>
            </>
          )}

          {step === "branch" && offer && confirmingPattern && (
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirmingPattern(false)}>
                Back
              </Button>
              <Button type="button" onClick={() => handleBranch(offer.primary)}>
                Yes, use it as a pattern
              </Button>
            </>
          )}

          {step === "cheatsheet" && (
            <Button type="button" onClick={onCancel}>
              Done
            </Button>
          )}

          {step === "review" && (
            <Button type="button" disabled={blockedReason !== null} onClick={() => void save(rows, activeFile)}>
              Save template
            </Button>
          )}
        </DialogFooter>

        {activeConfigRow && configIndex !== null && (
          <FieldConfigModal
            model={activeConfigRow.model}
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

function BranchBody({
  offer,
  confirming,
  rows,
}: {
  offer: BranchOffer;
  confirming: boolean;
  rows: EditableRow[];
}) {
  const fields = rows.filter((row) => !row.locked && row.line.trim().length > 0);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[14px] font-medium text-[#1a1814]">{offer.title}</p>
        <p className="text-[13px] text-[#5a5650]">{offer.body}</p>
      </div>

      {fields.length > 0 && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-[9px] border border-[#e6e3dc] bg-[#f7f6f3] p-3 sm:grid-cols-2">
          {fields.map((row) => (
            <div key={row.id} className="flex items-baseline gap-1.5 text-[12px]">
              <span className="text-[#3a5fd9]">•</span>
              <span className="truncate text-[#1a1814]">{row.model.label || row.line}</span>
              <span className="shrink-0 text-[#6d6a65]">({rowTypeLabel(row)})</span>
            </div>
          ))}
        </div>
      )}

      {offer.requiresConfirmation && confirming && (
        <p className="rounded-[9px] border border-[#e6d9b8] bg-[#fbf6e8] p-3 text-[13px] text-[#8a6d1f]">
          {offer.confirmationBody}
        </p>
      )}
    </div>
  );
}

function ReuploadPanel({
  inputRef,
  onFile,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#5a5650]">
        When you are done editing, upload the document here to pick the flow back up with your new
        data fields.
      </p>
      <button
        type="button"
        className="flex w-full flex-col items-center gap-2 rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-6 text-center text-[13px] text-[#6d6a65] transition-colors hover:border-[#c5d0f7] hover:bg-[#eef1fc] hover:text-[#3a5fd9]"
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={20} />
        Click to upload your edited .docx or .xlsx
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.xlsx"
        className="sr-only"
        onChange={onFile}
      />
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
        model={row.model}
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

      {/* A tag row's surrounding line already contains this same {{ tag }}, so
          showing it under the raw line above would just repeat the annotation.
          Context is only additive for AI spans, whose context is real prose. */}
      {row.context && row.kind !== "tag" && (
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
