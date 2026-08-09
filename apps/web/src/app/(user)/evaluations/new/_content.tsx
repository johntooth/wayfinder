"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/trpc/client";

// The create surface. An evaluation used to exist only if someone ran a terminal
// script over a hand-written manifest, which put starting one out of reach of the
// specialist the product is for.
//
// The corpus is picked, never typed: its id is also the evaluation's id, the
// object-storage prefix and the store key the classifier reads by, so a typed id
// that does not match produces a tender whose documents cannot be read.

interface FieldDraft {
  readonly name: string;
  readonly definition: string;
}

const BLANK_FIELD: FieldDraft = { name: "", definition: "" };

const inputClass =
  "rounded-[6px] border border-[#dedad2] bg-white px-[10px] py-[7px] text-[13px] text-[#1a1814] outline-none focus:border-[#3a5fd9]";

const sectionClass = "flex flex-col gap-[10px] rounded-[8px] border border-[#dedad2] bg-white p-[14px]";

const legendClass = "text-[13px] font-semibold text-[#1a1814]";

export function CreateEvaluationContent() {
  const router = useRouter();
  const [corpusId, setCorpusId] = useState("");
  const [name, setName] = useState("");
  const [brandByDocument, setBrandByDocument] = useState<Record<string, string>>({});
  const [chosenDocumentIds, setChosenDocumentIds] = useState<readonly string[]>([]);
  const [fields, setFields] = useState<readonly FieldDraft[]>([BLANK_FIELD]);

  const corporaQuery = trpc.evaluation.stagedCorpora.useQuery();
  const documentsQuery = trpc.evaluation.stagedDocuments.useQuery(
    { corpusId },
    { enabled: corpusId !== "" },
  );
  const createMutation = trpc.evaluation.create.useMutation({
    onSuccess: (evaluation) => router.push(`/evaluations/${evaluation.id}/grouping`),
  });

  // Switching corpus abandons choices made against the previous one — a document
  // id is only meaningful within its own corpus.
  const chooseCorpus = (nextCorpusId: string) => {
    setCorpusId(nextCorpusId);
    setChosenDocumentIds([]);
    setBrandByDocument({});
  };

  const toggleDocument = (documentId: string) => {
    setChosenDocumentIds((chosen) =>
      chosen.includes(documentId)
        ? chosen.filter((chosenId) => chosenId !== documentId)
        : [...chosen, documentId],
    );
  };

  const setField = (index: number, patch: Partial<FieldDraft>) => {
    setFields((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
    );
  };

  const documents = chosenDocumentIds.map((documentId) => ({
    documentId,
    brand: brandByDocument[documentId]?.trim() ?? "",
  }));

  const readyFields = fields.filter(
    (field) => field.name.trim() !== "" && field.definition.trim() !== "",
  );

  const submittable =
    corpusId !== "" &&
    name.trim() !== "" &&
    documents.length > 0 &&
    documents.every((document) => document.brand !== "") &&
    readyFields.length > 0 &&
    !createMutation.isPending;

  const submit = () => {
    createMutation.mutate({ corpusId, name: name.trim(), documents, fields: readyFields });
  };

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-[16px] px-[20px] py-[24px]">
      <header className="flex flex-col gap-[4px]">
        <h1 className="text-[20px] font-bold text-[#1a1814]">New evaluation</h1>
        <p className="max-w-[640px] text-[13px] text-[#5a5650]">
          Choose the staged corpus, say which brand each response belongs to, and
          name the fields the responses are read against.
        </p>
      </header>

      <fieldset className={sectionClass}>
        <legend className={legendClass}>Corpus</legend>

        {corporaQuery.isPending && <p className="text-[13px] text-[#6d6a65]">Loading corpora…</p>}

        {corporaQuery.isError && (
          <p className="text-[13px] text-[#b4413c]" role="alert">
            {corporaQuery.error.message}
          </p>
        )}

        {corporaQuery.data?.length === 0 && (
          <p className="text-[13px] text-[#6d6a65]" data-testid="corpora-empty">
            No corpus has been staged yet. An operator stages and extracts one
            before an evaluation can be created over it.
          </p>
        )}

        {corporaQuery.data && corporaQuery.data.length > 0 && (
          <select
            aria-label="Staged corpus"
            data-testid="corpus-select"
            className={inputClass}
            value={corpusId}
            onChange={(event) => chooseCorpus(event.target.value)}
          >
            <option value="">Select a corpus…</option>
            {corporaQuery.data.map((corpus) => (
              <option key={corpus.corpusId} value={corpus.corpusId}>
                {corpus.corpusId} · {corpus.documentCount} documents
              </option>
            ))}
          </select>
        )}

        <label className="flex flex-col gap-[4px]">
          <span className="text-[12px] text-[#5a5650]">Evaluation name</span>
          <input
            data-testid="evaluation-name"
            className={inputClass}
            value={name}
            placeholder="Water treatment panel 2026"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </fieldset>

      {corpusId !== "" && (
        <fieldset className={sectionClass}>
          <legend className={legendClass}>Documents and brands</legend>

          {documentsQuery.isPending && (
            <p className="text-[13px] text-[#6d6a65]">Loading documents…</p>
          )}

          {documentsQuery.isError && (
            <p className="text-[13px] text-[#b4413c]" role="alert">
              {documentsQuery.error.message}
            </p>
          )}

          {documentsQuery.data?.map((document) => (
            <div
              key={document.documentId}
              data-testid="staged-document"
              className="flex items-center gap-[10px] border-b border-[#f0ede8] pb-[8px] last:border-b-0"
            >
              <input
                type="checkbox"
                aria-label={`Include ${document.documentId}`}
                checked={chosenDocumentIds.includes(document.documentId)}
                onChange={() => toggleDocument(document.documentId)}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-[#1a1814]">
                  {document.preview || document.documentId}
                </span>
                <span className="truncate text-[11px] text-[#6d6a65]">
                  {document.documentId} · {document.chunkCount} chunks
                </span>
              </span>
              <input
                aria-label={`Brand for ${document.documentId}`}
                className={`${inputClass} w-[200px]`}
                placeholder="Brand"
                disabled={!chosenDocumentIds.includes(document.documentId)}
                value={brandByDocument[document.documentId] ?? ""}
                onChange={(event) =>
                  setBrandByDocument((brands) => ({
                    ...brands,
                    [document.documentId]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
        </fieldset>
      )}

      <fieldset className={sectionClass}>
        <legend className={legendClass}>Fields</legend>
        <p className="text-[12px] text-[#6d6a65]">
          Each field becomes a column in the review grid. The definition is what
          the adjudicator reasons from, so write it as you would explain it to a
          colleague.
        </p>

        {fields.map((field, index) => (
          <div key={index} data-testid="field-row" className="flex gap-[8px]">
            <input
              aria-label={`Field ${index + 1} name`}
              className={`${inputClass} w-[200px]`}
              placeholder="Warranty"
              value={field.name}
              onChange={(event) => setField(index, { name: event.target.value })}
            />
            <input
              aria-label={`Field ${index + 1} definition`}
              className={`${inputClass} flex-1`}
              placeholder="The warranty period offered and what it covers."
              value={field.definition}
              onChange={(event) => setField(index, { definition: event.target.value })}
            />
          </div>
        ))}

        <button
          type="button"
          data-testid="add-field"
          className="self-start rounded-[6px] border border-[#dedad2] px-[10px] py-[6px] text-[12px] text-[#3a5fd9] hover:border-[#c5d0f7]"
          onClick={() => setFields((current) => [...current, BLANK_FIELD])}
        >
          Add another field
        </button>
      </fieldset>

      {createMutation.isError && (
        <p className="text-[13px] text-[#b4413c]" role="alert" data-testid="create-error">
          {createMutation.error.message}
        </p>
      )}

      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          data-testid="create-evaluation"
          disabled={!submittable}
          onClick={submit}
          className="rounded-[6px] bg-[#3a5fd9] px-[14px] py-[8px] text-[13px] font-medium text-white disabled:bg-[#b9bfd4]"
        >
          {createMutation.isPending ? "Creating…" : "Create evaluation"}
        </button>
        <Link href="/evaluations" className="text-[13px] text-[#6d6a65] hover:text-[#3a5fd9]">
          Cancel
        </Link>
      </div>
    </div>
  );
}
