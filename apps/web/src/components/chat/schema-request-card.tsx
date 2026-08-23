"use client";

import { useState } from "react";
import { Plus, Table2, X } from "lucide-react";
import type { PendingSchemaRequest, SchemaRequestFieldDraft } from "@rbrasier/domain";
import { emptySchemaRequestFieldDraft, SCHEMA_REQUEST_FIELD_TYPES } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";
import {
  applyTypeChange,
  carriesOptions,
  parseOptionsInput,
  seedRows,
  withRowRemoved,
} from "./schema-request-card-model";

interface SchemaRequestCardProps {
  messageId: string;
  schemaRequest: PendingSchemaRequest;
  canEdit: boolean;
  onResolved?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  number: "Number",
  currency: "Currency",
  date: "Date",
  email: "Email",
  yesno: "Yes / No",
  select: "Single-select",
  multiselect: "Multi-select",
};

const CARD_CLASS =
  "w-full max-w-lg rounded-[10px] border border-[#e7e3db] bg-white p-[12px_14px] shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]";

// The in-feed schema-definition form (JOHNS-PLAN §1). It is keyed off the
// message rather than session state, so it renders where the model asked and
// survives a reload — the pending request is persisted, not held in the browser.
export function SchemaRequestCard({ messageId, schemaRequest, canEdit, onResolved }: SchemaRequestCardProps) {
  const [rows, setRows] = useState<SchemaRequestFieldDraft[]>(() => seedRows(schemaRequest));
  const [error, setError] = useState<string | null>(null);

  const submit = trpc.session.submitSchemaDefinition.useMutation({
    onSuccess: () => onResolved?.(),
    onError: (mutationError) => setError(mutationError.message),
  });
  const dismiss = trpc.session.dismissSchemaRequest.useMutation({
    onSuccess: () => onResolved?.(),
    onError: (mutationError) => setError(mutationError.message),
  });

  const isBusy = submit.isPending || dismiss.isPending;

  if (schemaRequest.status !== "pending") {
    return (
      <div className="my-3 flex justify-center">
        <div data-testid="schema-request-card" className={CARD_CLASS}>
          <p className="text-[13px] font-semibold text-[#1c1b19]">
            {schemaRequest.status === "submitted" ? "Report schema" : "Schema form dismissed"}
          </p>
          {schemaRequest.status === "submitted" && (
            <dl className="mt-1.5 space-y-1">
              {(schemaRequest.fields ?? []).map((field) => (
                <div key={field.key} className="flex gap-2 text-[12px]">
                  <dt className="shrink-0 font-medium text-[#666055]">{field.label}:</dt>
                  <dd className="min-w-0 flex-1 truncate text-[#1c1b19]">
                    {TYPE_LABELS[field.type] ?? field.type}
                    {field.required ? "" : " (optional)"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    );
  }

  const update = (index: number, patch: Partial<SchemaRequestFieldDraft>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const changeType = (index: number, type: string) =>
    setRows(rows.map((row, i) => (i === index ? applyTypeChange(row, type) : row)));

  const removeRow = (index: number) => setRows(withRowRemoved(rows, index));

  return (
    <div className="my-3 flex justify-center">
      <div data-testid="schema-request-card" className={CARD_CLASS}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#eaeefb] text-[#2f56d3]">
            <Table2 className="h-[18px] w-[18px] stroke-[1.8]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[#1c1b19]">Define the report schema</p>
            <p className="mt-1 text-[12px] text-[#666055]">{schemaRequest.prompt}</p>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  value={row.label}
                  onChange={(event) => update(index, { label: event.target.value })}
                  placeholder="e.g. Supplier Name"
                  aria-label={`Field ${index + 1} name`}
                  disabled={!canEdit || isBusy}
                  className="flex-1"
                />
                <select
                  aria-label={`Field ${index + 1} type`}
                  value={row.type}
                  disabled={!canEdit || isBusy}
                  onChange={(event) => changeType(index, event.target.value)}
                  className="h-10 shrink-0 rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-2 text-[13px] text-[#1c1b19] focus:border-[#2f56d3] focus:bg-white focus:outline-none disabled:cursor-default disabled:text-[#736d5f]"
                >
                  {SCHEMA_REQUEST_FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type] ?? type}
                    </option>
                  ))}
                </select>
                <label className="flex shrink-0 items-center gap-1 text-[12px] text-[#666055]">
                  <input
                    type="checkbox"
                    checked={row.required}
                    disabled={!canEdit || isBusy}
                    aria-label={`Field ${index + 1} required`}
                    onChange={(event) => update(index, { required: event.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="button"
                  aria-label={`Remove field ${index + 1}`}
                  disabled={!canEdit || isBusy}
                  className="shrink-0 rounded-md p-1.5 text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#a8324c]"
                  onClick={() => removeRow(index)}
                >
                  <X size={14} />
                </button>
              </div>
              {carriesOptions(row.type) && (
                <Input
                  value={row.options.join(", ")}
                  onChange={(event) => update(index, { options: parseOptionsInput(event.target.value) })}
                  placeholder="Choices, comma separated"
                  aria-label={`Field ${index + 1} choices`}
                  disabled={!canEdit || isBusy}
                />
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <button
            type="button"
            disabled={isBusy}
            className="mt-2 flex items-center gap-1 text-[12px] font-medium text-[#2f56d3] hover:underline"
            onClick={() => setRows([...rows, emptySchemaRequestFieldDraft()])}
          >
            <Plus size={13} />
            Add field
          </button>
        )}

        {error && (
          <p role="alert" className="mt-2 text-[12px] text-[#a8324c]">
            {error}
          </p>
        )}

        {canEdit && (
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={() => {
                setError(null);
                dismiss.mutate({ messageId });
              }}
            >
              Dismiss
            </Button>
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => {
                setError(null);
                submit.mutate({ messageId, fields: rows });
              }}
            >
              {submit.isPending ? "Saving…" : "Submit schema"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
