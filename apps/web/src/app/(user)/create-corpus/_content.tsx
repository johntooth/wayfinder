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

// The Create Corpus tab (fork mount): the *ingest* surface. It names the run,
// takes the raw documents, authors the allow-listed run config, and fires the
// womblex run — then the tracker hands over to /evaluations/new, which composes
// the evaluation over the extracted corpus.
//
// It does not name brands or fields. womblex is a cold-start engine and mints
// each document's source_hash on extract, so there is nothing to describe until
// the run has drained; the fork's own route comment already said ingest and
// evaluation were two users, and this is the tab catching up with it.
//
// The readiness rule (a run needs a name, a document, at least one stage) and
// the four-state run tracker (started / errored / resumable / done) are not
// re-implemented here: renderCreateCorpusView owns trigger.enabled, and
// evaluation.runStatus returns the already-shaped RunStatusViewModel. This
// component holds the draft, drives the procedure, and binds the DOM.

// Same shape as the extraction editor's own uploader (editor-cards.tsx), kept
// local rather than shared: the two flows post to different procedures and
// coupling this tab to the extraction editor buys nothing.
const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const inputClass =
  "rounded-[6px] border border-[#dedad2] bg-white px-[10px] py-[7px] text-[13px] text-[#1a1814] outline-none focus:border-[#3a5fd9]";
const sectionClass =
  "flex flex-col gap-[10px] rounded-[8px] border border-[#dedad2] bg-white p-[14px]";
const legendClass = "text-[13px] font-semibold text-[#1a1814]";

export function CreateCorpusContent() {
  const [runName, setRunName] = useState("");
  // The browser File objects, held as chosen. They are read to base64 only at
  // submit time, so re-picking or removing one costs nothing.
  const [files, setFiles] = useState<readonly File[]>([]);
  const [stageSequence, setStageSequence] =
    useState<readonly AuthorableStage[]>(DEFAULT_STAGE_SEQUENCE);
  const [chunkMode, setChunkMode] = useState<ChunkModeOverride | null>(null);
  const [moneyVocabulary, setMoneyVocabulary] = useState<MoneyVocabularyOverride | null>(null);
  // Set once the run is fired, so the tracker begins polling. Kept separate from
  // the mutation's own state because a resume replaces neither the run id nor the
  // corpus id — it re-fires the same run.
  const [runId, setRunId] = useState<string | null>(null);
  // Reading files to base64 happens before the mutation is called, so the button
  // needs its own in-flight flag to cover that window too.
  const [isReading, setIsReading] = useState(false);

  const draft: CreateCorpusDraft = {
    runName,
    uploads: files.map((file) => ({
      fileName: file.name,
      sizeBytes: file.size,
      // A browser leaves `type` empty for an extension it does not know; the
      // object store needs something, and the engine sniffs the bytes anyway.
      contentType: file.type === "" ? "application/octet-stream" : file.type,
    })),
    stageSequence,
    chunkMode,
    moneyVocabulary,
  };
  const view = useMemo(() => renderCreateCorpusView(draft), [draft]);

  // Re-picking appends rather than replaces, so a specialist can add documents
  // from more than one folder without losing the earlier choice.
  const chooseFiles = (chosen: FileList | null) => {
    if (chosen === null) return;
    setFiles((current) => [...current, ...Array.from(chosen)]);
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
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

  // One call stages every document and fires the run. The ordering is a rule the
  // controller owns and tests — nothing is staged unless the whole request is
  // valid, and the run never fires over a half-staged prefix — so this tab hands
  // over the whole request rather than sequencing two mutations itself.
  const createCorpusMutation = trpc.evaluation.createCorpus.useMutation({
    onSuccess: (created) => setRunId(created.runId),
  });

  const [readError, setReadError] = useState<string | null>(null);

  const start = async () => {
    setReadError(null);
    setIsReading(true);
    try {
      const wireFiles = await Promise.all(
        files.map(async (file) => ({
          filename: file.name,
          mimeType: file.type === "" ? "application/octet-stream" : file.type,
          contentBase64: await readFileAsBase64(file),
        })),
      );
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
      createCorpusMutation.mutate({
        runName: runName.trim(),
        files: wireFiles,
        stageSequence: [...stageSequence],
        ...(chunkMode || moneyVocabulary ? { configOverride } : {}),
      });
    } catch (error) {
      // A file the browser cannot read (removed from disk mid-flow, permission
      // withdrawn) must not present as a run failure — nothing was staged.
      setReadError(error instanceof Error ? error.message : "A chosen file could not be read.");
    } finally {
      setIsReading(false);
    }
  };

  const isFiring = isReading || createCorpusMutation.isPending;
  const submittable = view.trigger.enabled && !isFiring && runId === null;

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-[16px] px-[20px] py-[24px]">
      <header className="flex flex-col gap-[4px]">
        <h1 className="text-[20px] font-bold text-[#1a1814]">Create corpus</h1>
        <p className="max-w-[640px] text-[13px] text-[#5a5650]">
          Name the run, add the documents, and fire it. The engine extracts,
          chunks, embeds and reads them; once it settles you compose the
          evaluation over the corpus it produced.
        </p>
      </header>

      {runId === null ? (
        <>
          <fieldset className={sectionClass}>
            <legend className={legendClass}>Run</legend>
            <p className="text-[12px] text-[#6d6a65]">
              The name is the corpus: it names the womblex run, the object-store
              prefix its documents are staged under, and the corpus you compose
              the evaluation over afterwards.
            </p>

            <label className="flex flex-col gap-[4px]">
              <span className="text-[12px] text-[#5a5650]">Run name</span>
              <input
                data-testid="run-name"
                className={inputClass}
                value={runName}
                placeholder="tender-2026-water"
                onChange={(event) => setRunName(event.target.value)}
              />
            </label>
          </fieldset>

          <fieldset className={sectionClass}>
            <legend className={legendClass}>Documents</legend>
            <p className="text-[12px] text-[#6d6a65]">
              The raw documents to extract. Nothing needs to have been processed
              first — the engine extracts, chunks and reads them from here.
            </p>

            <input
              type="file"
              multiple
              aria-label="Documents to upload"
              data-testid="document-upload"
              className="text-[13px]"
              onChange={(event) => chooseFiles(event.target.files)}
            />

            <p className="text-[12px] text-[#6d6a65]" data-testid="upload-summary">
              {view.uploads.summary}
            </p>

            {view.uploads.rows.length > 0 && (
              <ul className="flex flex-col gap-[6px]" data-testid="upload-list">
                {view.uploads.rows.map((row, index) => (
                  <li
                    key={`${row.fileName}-${index}`}
                    className="flex items-center justify-between gap-[10px] text-[13px] text-[#1a1814]"
                  >
                    <span>
                      {row.fileName}{" "}
                      <span className="text-[12px] text-[#6d6a65]">{row.sizeLabel}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${row.fileName}`}
                      onClick={() => removeFile(index)}
                      className="text-[12px] text-[#6d6a65] hover:text-[#b4413c]"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
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

          {(createCorpusMutation.isError || readError !== null) && (
            <p className="text-[13px] text-[#b4413c]" role="alert" data-testid="start-error">
              {readError ?? createCorpusMutation.error?.message}
            </p>
          )}

          <div className="flex items-center gap-[10px]">
            <button
              type="button"
              data-testid="start-run"
              disabled={!submittable}
              onClick={() => void start()}
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
        <>
          <p className="text-[12px] text-[#6d6a65]">
            The corpus <strong>{status.evaluationId}</strong> is extracted and
            loaded. Compose the evaluation over it to name the brands and the
            fields its documents are read against.
          </p>
          <Link
            href="/evaluations/new"
            data-testid="open-evaluation"
            className="self-start rounded-[6px] bg-[#3a5fd9] px-[12px] py-[7px] text-[13px] font-medium text-white"
          >
            Compose the evaluation
          </Link>
        </>
      )}
    </div>
  );
}
