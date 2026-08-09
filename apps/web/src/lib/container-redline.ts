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
  WomblexExtractionReader,
  createRedlinePostgres,
  makeExtractionHardRuleCandidateDeriver,
} from "@redline/redline-adapters";
import type { ILanguageModel as WayfinderLanguageModel } from "@rbrasier/domain";
import { RedlineLanguageModelBridge } from "./redline-language-model";

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
  readonly productName: string;
}

export interface RedlineModule {
  readonly workflowController: WorkflowController;
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
    productName: dependencies.productName,
  });
  if (container.error) return container;

  return ok({ workflowController: new WorkflowController(container.data) });
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

  // The cold-start path (ADR-0008 first pass): hard rules + adjudication over the
  // store's exact fetch, against the lens the reader resolves per call — which is
  // what makes one classifier instance safe at a process-wide memoised container.
  const classifier = new ColdStartClassifier({
    chunkStore: new DrizzleChunkStore(database),
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
