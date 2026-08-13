"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  renderCreateCorpusView,
  AUTHORABLE_STAGES,
  DEFAULT_STAGE_SEQUENCE,
  type CreateCorpusDraft,
} from "@redline/redline-web";
import type {
  AuthorableStage,
  ChunkModeOverride,
  MoneyVocabularyOverride,
} from "@redline/redline-domain";
import { trpc } from "@/trpc/client";

interface FieldDraft {
  readonly name: string;
  readonly definition: string;
}

const BLANK_FIELD: FieldDraft = { name: "", definition: "" };

// The Create Corpus tab (redline delivery-plan §2 item 1, fork mount). It picks
// an already-staged corpus and its documents (raw-bucket upload is deferred),
// names the evaluation, authors the allow-listed run config, then creates the
// evaluation and fires the womblex run — ingest → lens → grouping → build.
//
// The readiness rule (a run needs a corpus, a document, a name, at least one
// stage) and the four-state run tracker (started / errored / resumable / done)
// are not re-implemented here: renderCreateCorpusView owns trigger.enabled, and
// evaluation.runStatus returns the already-shaped RunStatusViewModel. This
// component holds the draft, drives the procedures, and binds the DOM.

const inputClass =
  "rounded-[6px] border border-[#dedad2] bg-white px-[10px] py-[7px] text-[13px] text-[#1a1814] outline-none focus:border-[#3a5fd9]";
const sectionClass =
  "flex flex-col gap-[10px] rounded-[8px] border border-[#dedad2] bg-white p-[14px]";
const legendClass = "text-[13px] font-semibold text-[#1a1814]";

export function CreateCorpusContent() {
  const [selectedCorpusId, setSelectedCorpusId] = useState<string | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<readonly string[]>([]);
  const [evaluationName, setEvaluationName] = useState("");
  const [stageSequence, setStageSequence] =
    useState<readonly AuthorableStage[]>(DEFAULT_STAGE_SEQUENCE);
  const [chunkMode, setChunkMode] = useState<ChunkModeOverride | null>(null);
  const [moneyVocabulary, setMoneyVocabulary] = useState<MoneyVocabularyOverride | null>(null);
  // Set once the run is fired, so the tracker begins polling. Kept separate from
  // the mutations' own state because a resume replaces neither the run id nor the
  // evaluation id — it re-fires the same run.
  const [runId, setRunId] = useState<string | null>(null);

  const corporaQuery = trpc.evaluation.stagedCorpora.useQuery();
  const documentsQuery = trpc.evaluation.stagedDocuments.useQuery(
    { corpusId: selectedCorpusId ?? "" },
    { enabled: selectedCorpusId !== null },
  );

  const draft: CreateCorpusDraft = {
    corpora: corporaQuery.data ?? [],
    selectedCorpusId,
    documents: documentsQuery.data ?? [],
    selectedDocumentIds,
    evaluationName,
    stageSequence,
    chunkMode,
    moneyVocabulary,
  };
  const view = useMemo(() => renderCreateCorpusView(draft), [draft]);

  // Switching corpus abandons the document choices made against the previous one
  // — a document id is only meaningful within its own corpus.
  const chooseCorpus = (nextCorpusId: string) => {
    setSelectedCorpusId(nextCorpusId === "" ? null : nextCorpusId);
    setSelectedDocumentIds([]);
  };

  const toggleDocument = (documentId: string) => {
    setSelectedDocumentIds((chosen) =>
      chosen.includes(documentId)
        ? chosen.filter((id) => id !== documentId)
        : [...chosen, documentId],
    );
  };

  const toggleStage = (stage: AuthorableStage) => {
    setStageSequence((current) =>
      current.includes(stage)
        ? current.filter((entry) => entry !== stage)
        : AUTHORABLE_STAGES.filter((entry) => entry === stage || current.includes(entry)),
    );
  };

  // The chunk-mode override group. Null means the field is blank and the run
  // inherits the redline.yaml default; enabling it seeds the offline token
  // chunking the profile ships, which the specialist then adjusts. The domain
  // re-validates a non-positive size below the seam.
  const setChunkModeField = (patch: Partial<ChunkModeOverride>) =>
    setChunkMode((current) => ({
      chunkingModel: current?.chunkingModel ?? null,
      chunkSize: current?.chunkSize ?? 480,
      chunkTables: current?.chunkTables ?? true,
      ...patch,
    }));

  // The money-vocabulary override group, same inherit-when-blank rule. Terms are
  // typed as a comma-separated list and split here; the domain lower-cases and
  // de-duplicates them, and rejects a non-ISO currency.
  const setMoneyField = (patch: Partial<MoneyVocabularyOverride>) =>
    setMoneyVocabulary((current) => ({
      extraHeaderTerms: current?.extraHeaderTerms ?? [],
      extraVetoTerms: current?.extraVetoTerms ?? [],
      defaultCurrency: current?.defaultCurrency ?? "AUD",
      ...patch,
    }));

  const splitTerms = (value: string): string[] =>
    value
      .split(",")
      .map((term) => term.trim())
      .filter((term) => term !== "");

  const startRunMutation = trpc.evaluation.startRun.useMutation({
    onSuccess: (run) => setRunId(run.runId),
  });
  const createMutation = trpc.evaluation.create.useMutation({
    onSuccess: (evaluation) => {
      // Shape the override for the wire: the zod input takes mutable arrays, and
      // the state holds the domain's readonly ones, so copy them across.
      const configOverride = {
        ...(chunkMode ? { chunkMode } : {}),
        ...(moneyVocabulary
          ? {
              moneyVocabulary: {
                extraHeaderTerms: [...moneyVocabulary.extraHeaderTerms],
                extraVetoTerms: [...moneyVocabulary.extraVetoTerms],
                defaultCurrency: moneyVocabulary.defaultCurrency,
              },
            }
          : {}),
      };
      startRunMutation.mutate({
        evaluationId: evaluation.id,
        stageSequence: [...stageSequence],
        ...(chunkMode || moneyVocabulary ? { configOverride } : {}),
      });
    },
  });

  // The corpus id is the evaluation id, and each chosen document carries a brand.
  // The picker chooses hashes, so the brand is typed against each; the create
  // procedure re-validates a blank one.
  const [brandByDocument, setBrandByDocument] = useState<Record<string, string>>({});

  // The fields the responses are read against become the comprehension lens's
  // topics — CreateEvaluation needs at least one, so this is not optional even on
  // an ingest-led surface. Same shape as /evaluations/new.
  const [fields, setFields] = useState<readonly FieldDraft[]>([BLANK_FIELD]);

  const setField = (index: number, patch: Partial<FieldDraft>) => {
    setFields((current) =>
      current.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      ),
    );
  };

  const readyFields = fields.filter(
    (field) => field.name.trim() !== "" && field.definition.trim() !== "",
  );

  const start = () => {
    if (selectedCorpusId === null) return;
    createMutation.mutate({
      corpusId: selectedCorpusId,
      name: evaluationName.trim(),
      documents: selectedDocumentIds.map((documentId) => ({
        documentId,
        brand: brandByDocument[documentId]?.trim() ?? "",
      })),
      fields: readyFields.map((field) => ({
        name: field.name.trim(),
        definition: field.definition.trim(),
      })),
    });
  };

  const isFiring = createMutation.isPending || startRunMutation.isPending;
  const brandsReady = selectedDocumentIds.every(
    (documentId) => (brandByDocument[documentId]?.trim() ?? "") !== "",
  );
  const submittable =
    view.trigger.enabled &&
    brandsReady &&
    readyFields.length > 0 &&
    !isFiring &&
    runId === null;

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-[16px] px-[20px] py-[24px]">
      <header className="flex flex-col gap-[4px]">
        <h1 className="text-[20px] font-bold text-[#1a1814]">Create corpus</h1>
        <p className="max-w-[640px] text-[13px] text-[#5a5650]">
          Choose a staged corpus, name the evaluation, and fire the run. The
          engine extracts, chunks, embeds and reads the documents; the evaluation
          lands ready to group and review.
        </p>
      </header>

      {runId === null ? (
        <>
          <fieldset className={sectionClass}>
            <legend className={legendClass}>Corpus</legend>

            {corporaQuery.isPending && (
              <p className="text-[13px] text-[#6d6a65]">Loading corpora…</p>
            )}

            {corporaQuery.isError && (
              <p className="text-[13px] text-[#b4413c]" role="alert">
                {corporaQuery.error.message}
              </p>
            )}

            {corporaQuery.data?.length === 0 && (
              <p className="text-[13px] text-[#6d6a65]" data-testid="corpora-empty">
                No corpus has been staged yet. An operator stages one over object
                storage before a run can be fired over it.
              </p>
            )}

            {view.picker.corpora.length > 0 && (
              <select
                aria-label="Staged corpus"
                data-testid="corpus-select"
                className={inputClass}
                value={selectedCorpusId ?? ""}
                onChange={(event) => chooseCorpus(event.target.value)}
              >
                <option value="">Select a corpus…</option>
                {view.picker.corpora.map((corpus) => (
                  <option key={corpus.corpusId} value={corpus.corpusId}>
                    {corpus.label}
                  </option>
                ))}
              </select>
            )}

            <label className="flex flex-col gap-[4px]">
              <span className="text-[12px] text-[#5a5650]">Evaluation name</span>
              <input
                data-testid="evaluation-name"
                className={inputClass}
                value={evaluationName}
                placeholder="Water treatment panel 2026"
                onChange={(event) => setEvaluationName(event.target.value)}
              />
            </label>
          </fieldset>

          {selectedCorpusId !== null && (
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

              {view.picker.documents.map((document) => (
                <div
                  key={document.documentId}
                  data-testid="staged-document"
                  className="flex items-center gap-[10px] border-b border-[#f0ede8] pb-[8px] last:border-b-0"
                >
                  <input
                    type="checkbox"
                    aria-label={`Include ${document.documentId}`}
                    checked={document.selected}
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
                    disabled={!document.selected}
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
              Each field becomes a column the responses are read against. The
              definition is what the adjudicator reasons from, so write it as you
              would explain it to a colleague.
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

          <fieldset className={sectionClass}>
            <legend className={legendClass}>Stages to run</legend>
            <p className="text-[12px] text-[#6d6a65]">
              The downstream passes the engine runs after extraction. Leave the
              default to run the whole sequence the corpus profile ships.
            </p>
            <div className="flex flex-wrap gap-[10px]">
              {view.config.stageSequence.stages.map((stage) => (
                <label key={stage.stage} className="flex items-center gap-[6px] text-[13px]">
                  <input
                    type="checkbox"
                    aria-label={`Run ${stage.label} stage`}
                    checked={stage.enabled}
                    onChange={() => toggleStage(stage.stage)}
                  />
                  {stage.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={sectionClass}>
            <legend className={legendClass}>Advanced run config</legend>
            <p className="text-[12px] text-[#6d6a65]">
              The allow-listed slice of the engine config. Leave a group off and
              the run inherits the corpus profile default.
            </p>

            <label className="flex items-center gap-[6px] text-[13px]">
              <input
                type="checkbox"
                aria-label="Override chunk mode"
                checked={!view.config.chunkMode.inheritsDefault}
                onChange={(event) => setChunkMode(event.target.checked ? { chunkingModel: null, chunkSize: 480, chunkTables: true } : null)}
              />
              Override chunk mode
            </label>
            {!view.config.chunkMode.inheritsDefault && (
              <div className="flex flex-wrap items-center gap-[10px] pl-[22px]">
                <label className="flex flex-col gap-[4px]">
                  <span className="text-[12px] text-[#5a5650]">Chunk size (tokens)</span>
                  <input
                    type="number"
                    aria-label="Chunk size in tokens"
                    className={`${inputClass} w-[140px]`}
                    value={view.config.chunkMode.chunkSize ?? 480}
                    onChange={(event) => setChunkModeField({ chunkSize: Number(event.target.value) })}
                  />
                </label>
                <label className="flex items-center gap-[6px] text-[13px]">
                  <input
                    type="checkbox"
                    aria-label="Chunk tables"
                    checked={view.config.chunkMode.chunkTables ?? true}
                    onChange={(event) => setChunkModeField({ chunkTables: event.target.checked })}
                  />
                  Chunk tables
                </label>
              </div>
            )}

            <label className="flex items-center gap-[6px] text-[13px]">
              <input
                type="checkbox"
                aria-label="Override money vocabulary"
                checked={!view.config.moneyVocabulary.inheritsDefault}
                onChange={(event) =>
                  setMoneyVocabulary(
                    event.target.checked
                      ? { extraHeaderTerms: [], extraVetoTerms: [], defaultCurrency: "AUD" }
                      : null,
                  )
                }
              />
              Override money vocabulary
            </label>
            {!view.config.moneyVocabulary.inheritsDefault && (
              <div className="flex flex-col gap-[8px] pl-[22px]">
                <label className="flex flex-col gap-[4px]">
                  <span className="text-[12px] text-[#5a5650]">Default currency (ISO 4217)</span>
                  <input
                    aria-label="Default currency"
                    className={`${inputClass} w-[140px]`}
                    value={view.config.moneyVocabulary.defaultCurrency ?? "AUD"}
                    onChange={(event) => setMoneyField({ defaultCurrency: event.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-[4px]">
                  <span className="text-[12px] text-[#5a5650]">Extra header terms (comma-separated)</span>
                  <input
                    aria-label="Extra header terms"
                    className={inputClass}
                    defaultValue={view.config.moneyVocabulary.extraHeaderTerms.join(", ")}
                    onChange={(event) => setMoneyField({ extraHeaderTerms: splitTerms(event.target.value) })}
                  />
                </label>
                <label className="flex flex-col gap-[4px]">
                  <span className="text-[12px] text-[#5a5650]">Extra veto terms (comma-separated)</span>
                  <input
                    aria-label="Extra veto terms"
                    className={inputClass}
                    defaultValue={view.config.moneyVocabulary.extraVetoTerms.join(", ")}
                    onChange={(event) => setMoneyField({ extraVetoTerms: splitTerms(event.target.value) })}
                  />
                </label>
              </div>
            )}
          </fieldset>

          {(startRunMutation.isError || createMutation.isError) && (
            <p className="text-[13px] text-[#b4413c]" role="alert" data-testid="start-error">
              {(startRunMutation.error ?? createMutation.error)?.message}
            </p>
          )}

          <div className="flex items-center gap-[10px]">
            <button
              type="button"
              data-testid="start-run"
              disabled={!submittable}
              onClick={start}
              className="rounded-[6px] bg-[#3a5fd9] px-[14px] py-[8px] text-[13px] font-medium text-white disabled:bg-[#b9bfd4]"
            >
              {isFiring ? "Starting…" : view.trigger.label}
            </button>
            <Link href="/evaluations" className="text-[13px] text-[#6d6a65] hover:text-[#3a5fd9]">
              Cancel
            </Link>
          </div>
        </>
      ) : (
        <RunTracker runId={runId} />
      )}
    </div>
  );
}

// The run tracker: polls evaluation.runStatus into the four-state view model and
// renders whichever state the run is in. shouldKeepPolling — owned by
// renderRunStatusView below the seam — decides whether to schedule another poll,
// so an errored run never spins forever and a done one stops.
function RunTracker({ runId }: { runId: string }) {
  const statusQuery = trpc.evaluation.runStatus.useQuery(
    { runId },
    {
      refetchInterval: (query) =>
        query.state.data?.shouldKeepPolling ? 2500 : false,
    },
  );
  const resumeMutation = trpc.evaluation.resumeRun.useMutation({
    onSuccess: () => statusQuery.refetch(),
  });

  if (statusQuery.isPending) {
    return <p className="text-[13px] text-[#6d6a65]">Starting the run…</p>;
  }

  if (statusQuery.isError) {
    return (
      <p className="text-[13px] text-[#b4413c]" role="alert" data-testid="run-error">
        {statusQuery.error.message}
      </p>
    );
  }

  const status = statusQuery.data;

  return (
    <div className={sectionClass} data-testid="run-tracker">
      <div className="flex items-center justify-between gap-[12px]">
        <span className="text-[14px] font-semibold text-[#1a1814]">{status.statusLabel}</span>
        {status.isRunning && (
          <span className="text-[11px] text-[#6d6a65]" data-testid="run-running">
            Running…
          </span>
        )}
      </div>

      {status.completedStages.length > 0 && (
        <p className="text-[12px] text-[#6d6a65]">
          Completed: {status.completedStages.join(" · ")}
        </p>
      )}

      {status.isErrored && (
        <p className="text-[13px] text-[#b4413c]" role="alert">
          {status.errorMessage ?? "The run failed."}
        </p>
      )}

      {status.canResume && (
        <button
          type="button"
          data-testid="resume-run"
          disabled={resumeMutation.isPending}
          onClick={() => resumeMutation.mutate({ runId })}
          className="self-start rounded-[6px] bg-[#3a5fd9] px-[12px] py-[7px] text-[13px] font-medium text-white disabled:bg-[#b9bfd4]"
        >
          {resumeMutation.isPending ? "Resuming…" : "Resume run"}
        </button>
      )}

      {status.isComplete && (
        <Link
          href={`/evaluations/${status.evaluationId}/grouping`}
          data-testid="open-evaluation"
          className="self-start rounded-[6px] bg-[#3a5fd9] px-[12px] py-[7px] text-[13px] font-medium text-white"
        >
          Open the evaluation
        </Link>
      )}
    </div>
  );
}
