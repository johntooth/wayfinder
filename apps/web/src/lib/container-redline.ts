import {
  WorkflowController,
  buildContainer,
  type WorkflowContainer,
} from "@redline/redline-web";
import { ok, type Result } from "@redline/redline-domain";
import type {
  IClassificationLensWriter,
  IEvaluationRepository,
  IFinancialExtractor,
  ILanguageModel,
  IProcurementClassifier,
  IProcurementExtractionReader,
  IStagedCorpusReader,
  IStagedCorpusWriter,
  IWomblexRunTrigger,
} from "@redline/redline-domain";
import {
  ColdStartClassifier,
  IngestDocuments,
  MoneySpanFinancialExtractor,
} from "@redline/redline-application";
import {
  DrizzleChunkStore,
  DrizzleClassificationLensReader,
  DrizzleClassificationLensWriter,
  DrizzleEvaluationRepository,
  DrizzleMoneySpanStore,
  DrizzleStagedCorpusReader,
  HttpAdjudicator,
  HttpWomblexRunTrigger,
  WomblexExtractionReader,
  createRedlinePostgres,
  createStagedCorpusWriter,
  makeExtractionHardRuleCandidateDeriver,
} from "@redline/redline-adapters";
import type { ILanguageModel as WayfinderLanguageModel } from "@rbrasier/domain";
import type { ReportChunkVerifier } from "@rbrasier/adapters";
import { RedlineLanguageModelBridge } from "./redline-language-model";
import { ChunkStoreReportVerifier } from "./redline-report-verifier";

// redline's UI mount (ADR-0019, delivery-plan item 3 step 3), factored out of
// container.ts the way container-extraction.ts is: it wires redline's
// WorkflowController and hands it back for the fork's container to expose as
// `redline.workflowController` — the seam the evaluation router (step 2) reads.
//
// Option A of the step: the ports that already have production adapters
// (IEvaluationRepository over the redline_ schema, IProcurementExtractionReader
// over the womblex-ingest JSON seam) and the ones that do not yet
// (IProcurementClassifier — the cold-start path's store + adjudicator; the
// money-sidecar IFinancialExtractor of item 2; the summary ILanguageModel) all
// cross this module boundary as injected dependencies. The module composes them
// into a controller through buildContainer's own validation; it never
// constructs a port itself, so no not-yet-built adapter is invented here. The
// caller resolves each port as its adapter lands (items 1, 2, 4).

export interface RedlineModuleDependencies {
  readonly repository: IEvaluationRepository;
  readonly classifier: IProcurementClassifier;
  readonly financialExtractor: IFinancialExtractor;
  readonly extractionReader: IProcurementExtractionReader;
  readonly languageModel: ILanguageModel;
  // The create half (delivery-plan §2 item 1). The served container carried no
  // write capability until an evaluation could be started from the browser.
  readonly stagedCorpusReader: IStagedCorpusReader;
  readonly lensWriter: IClassificationLensWriter;
  // The run half (delivery-plan §2 item 1). The two write seams that turn a
  // composed evaluation into a review grid without a terminal: the object-store
  // writer stages a specialist's chosen bytes under the evaluation's input
  // prefix, and the run trigger fires ingest → lens → grouping → build.
  readonly stagedCorpusWriter: IStagedCorpusWriter;
  readonly runTrigger: IWomblexRunTrigger;
  // The report assembler's store re-fetch, backed by redline's IChunkStore.
  readonly reportChunkVerifier: ReportChunkVerifier;
  readonly productName: string;
}

export interface RedlineModule {
  readonly workflowController: WorkflowController;
  // The store-backed re-fetch the fork's report assembly loop asserts byte-identity
  // against (architecture §5.1). Carried on the served module because the assembler
  // runs in a served request, not the seeder.
  readonly reportChunkVerifier: ReportChunkVerifier;
}

// Returns a Result because buildContainer validates the container parts (a blank
// product name is rejected there); the fork's container surfaces the controller
// only once the parts compose, so the failure rides the type boundary rather
// than throwing across it.
export const buildRedlineModule = (
  dependencies: RedlineModuleDependencies,
): Result<RedlineModule> => {
  const container: Result<WorkflowContainer> = buildContainer({
    repository: dependencies.repository,
    classifier: dependencies.classifier,
    financialExtractor: dependencies.financialExtractor,
    extractionReader: dependencies.extractionReader,
    languageModel: dependencies.languageModel,
    stagedCorpusReader: dependencies.stagedCorpusReader,
    lensWriter: dependencies.lensWriter,
    stagedCorpusWriter: dependencies.stagedCorpusWriter,
    runTrigger: dependencies.runTrigger,
    productName: dependencies.productName,
  });
  if (container.error) return container;

  return ok({
    workflowController: new WorkflowController(container.data),
    reportChunkVerifier: dependencies.reportChunkVerifier,
  });
};

// The live resolution: every port above bound to its production adapter
// (delivery-plan §2 item 1). Split from buildRedlineModule so the composition
// stays testable with fakes while this half owns the env-driven construction.
//
// Returns null — not an error — when REDLINE_DATABASE_URL is absent. This fork
// must still boot as plain Wayfinder with no redline stack behind it; the
// evaluation router then fails per-request rather than the whole app failing to
// start.

export interface RedlineRuntimeEnv {
  readonly REDLINE_DATABASE_URL?: string | undefined;
  readonly REDLINE_WOMBLEX_INGEST_URL?: string | undefined;
  readonly REDLINE_ADJUDICATOR_BASE_URL?: string | undefined;
  readonly REDLINE_ADJUDICATOR_API_KEY?: string | undefined;
  readonly REDLINE_ADJUDICATOR_MODEL?: string | undefined;
  readonly REDLINE_PRODUCT_NAME?: string | undefined;
  // The object-store coordinates the staged-corpus writer stages bytes into —
  // the same S3_* / REDLINE_BUCKET values the sidecar and compose profiles use,
  // so redline never restates its bucket coordinates.
  readonly S3_ENDPOINT?: string | undefined;
  readonly S3_ACCESS_KEY?: string | undefined;
  readonly S3_SECRET_KEY?: string | undefined;
  readonly S3_REGION?: string | undefined;
  readonly REDLINE_BUCKET?: string | undefined;
}

export interface ResolveRedlineModuleInput {
  readonly env: RedlineRuntimeEnv;
  readonly wayfinderLanguageModel: WayfinderLanguageModel;
}

const fetchJson = async (url: string) => {
  const response = await fetch(url);
  return { ok: response.ok, status: response.status, json: () => response.json() };
};

const postJson = async (request: {
  readonly method: "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  return { ok: response.ok, status: response.status, json: () => response.json() };
};

// The run trigger's `fetch`-shaped seam: method + optional body, so the adapter
// POSTs a run and GETs its status without assuming a global fetch is bound at
// construction.
const runTriggerFetch = async (request: {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly body?: unknown;
}) => {
  const response = await fetch(request.url, {
    method: request.method,
    ...(request.body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) }),
  });
  return { ok: response.ok, status: response.status, json: () => response.json() };
};

// Split the S3 endpoint URL into the host/port/scheme the minio Client takes
// separately (it does not parse a URL). An `http://` endpoint yields useSSL
// false; an explicit port wins, else 80/443 by scheme.
const parseS3Endpoint = (
  endpoint: string,
): { readonly host: string; readonly port: number; readonly useSSL: boolean } => {
  const url = new URL(endpoint);
  const useSSL = url.protocol === "https:";
  const port = url.port === "" ? (useSSL ? 443 : 80) : Number(url.port);
  return { host: url.hostname, port, useSSL };
};

// The env-driven adapter construction, shared by the served module and the
// corpus seeder so the two can never drift onto different adapters.
const resolveRedlineAdapters = (input: ResolveRedlineModuleInput) => {
  const { env } = input;
  const databaseUrl = env.REDLINE_DATABASE_URL;
  if (!databaseUrl) return null;

  const database = createRedlinePostgres({ databaseUrl });

  const extractionReader = new WomblexExtractionReader({
    baseUrl: env.REDLINE_WOMBLEX_INGEST_URL ?? "http://womblex-ingest:8000",
    httpClient: fetchJson,
  });

  // The run half's two write seams (delivery-plan §2 item 1). The writer stages
  // bytes into redline's own bucket at the endpoint the sidecar reads its input
  // from; the trigger fires the run over the same womblex-ingest sidecar the
  // extraction reader reads through, so both ends of a run share one base URL.
  const s3 = parseS3Endpoint(env.S3_ENDPOINT ?? "http://minio:9000");
  const stagedCorpusWriter = createStagedCorpusWriter({
    endpoint: s3.host,
    port: s3.port,
    useSSL: s3.useSSL,
    accessKey: env.S3_ACCESS_KEY ?? "minioadmin",
    secretKey: env.S3_SECRET_KEY ?? "minioadmin",
    bucket: env.REDLINE_BUCKET ?? "redline",
    ...(env.S3_REGION ? { region: env.S3_REGION } : {}),
  });
  const runTrigger = new HttpWomblexRunTrigger({
    baseUrl: env.REDLINE_WOMBLEX_INGEST_URL ?? "http://womblex-ingest:8000",
    httpClient: runTriggerFetch,
  });

  // One chunk store, shared by the classifier's exact fetch and the report
  // assembler's byte-identity re-fetch — both read the same redline_chunks rows,
  // so they must not diverge onto two handles.
  const chunkStore = new DrizzleChunkStore(database);

  // The cold-start path (ADR-0008 first pass): hard rules + adjudication over the
  // store's exact fetch, against the lens the reader resolves per call — which is
  // what makes one classifier instance safe at a process-wide memoised container.
  const classifier = new ColdStartClassifier({
    chunkStore,
    adjudicator: new HttpAdjudicator({
      baseUrl: env.REDLINE_ADJUDICATOR_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: env.REDLINE_ADJUDICATOR_API_KEY ?? "",
      model: env.REDLINE_ADJUDICATOR_MODEL ?? "gpt-4o-mini",
      httpClient: postJson,
    }),
    lensReader: new DrizzleClassificationLensReader({
      database,
      deriveCandidates: makeExtractionHardRuleCandidateDeriver(extractionReader),
    }),
  });

  return {
    database,
    repository: new DrizzleEvaluationRepository(database),
    classifier,
    financialExtractor: new MoneySpanFinancialExtractor({
      moneySpanStore: new DrizzleMoneySpanStore(database),
    }),
    extractionReader,
    languageModel: new RedlineLanguageModelBridge(input.wayfinderLanguageModel),
    stagedCorpusReader: new DrizzleStagedCorpusReader(database),
    lensWriter: new DrizzleClassificationLensWriter(database),
    stagedCorpusWriter,
    runTrigger,
    reportChunkVerifier: new ChunkStoreReportVerifier(chunkStore),
    productName: env.REDLINE_PRODUCT_NAME ?? "the product",
  };
};

export const resolveRedlineModule = (
  input: ResolveRedlineModuleInput,
): Result<RedlineModule> | null => {
  const adapters = resolveRedlineAdapters(input);
  if (!adapters) return null;

  return buildRedlineModule({
    repository: adapters.repository,
    classifier: adapters.classifier,
    financialExtractor: adapters.financialExtractor,
    extractionReader: adapters.extractionReader,
    languageModel: adapters.languageModel,
    stagedCorpusReader: adapters.stagedCorpusReader,
    lensWriter: adapters.lensWriter,
    stagedCorpusWriter: adapters.stagedCorpusWriter,
    runTrigger: adapters.runTrigger,
    reportChunkVerifier: adapters.reportChunkVerifier,
    productName: adapters.productName,
  });
};

// The corpus seeder's parts (delivery-plan §2 item 1). Deliberately NOT on
// RedlineModule: nothing served writes an evaluation or a lens, and the served
// container should not hold a capability no route uses. The seeding script
// resolves these directly.
export interface RedlineSeedDependencies {
  readonly repository: IEvaluationRepository;
  readonly ingestDocuments: IngestDocuments;
  readonly lensWriter: IClassificationLensWriter;
  readonly workflowController: WorkflowController;
}

export const resolveRedlineSeedDependencies = (
  input: ResolveRedlineModuleInput,
): Result<RedlineSeedDependencies> | null => {
  const adapters = resolveRedlineAdapters(input);
  if (!adapters) return null;

  const module = buildRedlineModule({
    repository: adapters.repository,
    classifier: adapters.classifier,
    financialExtractor: adapters.financialExtractor,
    extractionReader: adapters.extractionReader,
    languageModel: adapters.languageModel,
    stagedCorpusReader: adapters.stagedCorpusReader,
    lensWriter: adapters.lensWriter,
    stagedCorpusWriter: adapters.stagedCorpusWriter,
    runTrigger: adapters.runTrigger,
    reportChunkVerifier: adapters.reportChunkVerifier,
    productName: adapters.productName,
  });
  if (module.error) return module;

  return ok({
    repository: adapters.repository,
    ingestDocuments: new IngestDocuments({
      repository: adapters.repository,
      extractionReader: adapters.extractionReader,
    }),
    lensWriter: adapters.lensWriter,
    workflowController: module.data.workflowController,
  });
};
