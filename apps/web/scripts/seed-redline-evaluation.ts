import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCorpusManifest } from "../src/lib/redline-corpus-manifest";
import { seedEvaluation } from "../src/lib/redline-seed-evaluation";
import { resolveRedlineSeedDependencies } from "../src/lib/container-redline";
import { getContainer } from "../src/lib/container";

// The corpus driver (delivery-plan §2 item 1). Creates an evaluation from a
// manifest, seeds its lens, records its vendors and response groups, classifies
// and builds the review table — then prints the evaluation id, which is what
// opens the served review grid and what E2E_REDLINE_EVALUATION_ID needs.
//
// A script rather than a tRPC mutation on purpose: a mutation would drag in the
// stage machine it should not own yet, and the grouping page is read-only until
// that lands.
//
// Usage: pnpm --filter @wayfinder/web exec tsx scripts/seed-redline-evaluation.ts <manifest.json>

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const readManifestFile = async (path: string): Promise<unknown> => {
  const raw = await readFile(path, "utf8").catch((cause: unknown) =>
    fail(`cannot read manifest ${path}: ${String(cause)}`),
  );

  try {
    return JSON.parse(raw as string);
  } catch (cause) {
    return fail(`manifest ${path} is not valid JSON: ${String(cause)}`);
  }
};

const main = async (): Promise<void> => {
  const manifestArgument = process.argv[2];
  if (!manifestArgument) {
    fail("usage: seed-redline-evaluation.ts <manifest.json>");
    return;
  }

  const manifestPath = resolve(process.cwd(), manifestArgument);
  const manifest = parseCorpusManifest(await readManifestFile(manifestPath));
  if (manifest.error) {
    fail(`manifest ${manifestPath} is invalid: ${manifest.error.message}`);
    return;
  }

  // The seeding parts are resolved here rather than read off the container's
  // `redline` seam: nothing served writes an evaluation, so the served module
  // does not carry a write capability just for this script. The container is
  // still the only source of the governed Wayfinder language model.
  const container = getContainer();
  const dependencies = resolveRedlineSeedDependencies({
    env: container.env,
    wayfinderLanguageModel: container.services.llm,
  });
  if (dependencies === null) {
    fail("REDLINE_DATABASE_URL is not set — the redline stack is not configured for this process");
    return;
  }
  if (dependencies.error) {
    fail(`cannot wire the redline stack: ${dependencies.error.message}`);
    return;
  }

  const seeded = await seedEvaluation(manifest.data, dependencies.data);
  if (seeded.error) {
    fail(`seeding failed: ${seeded.error.message}`);
    return;
  }

  process.stdout.write(
    `evaluation ${seeded.data.evaluationId} is at stage ${seeded.data.stage} with ` +
      `${seeded.data.responseCount} response rows\n` +
      `open /evaluations/${seeded.data.evaluationId}/review\n` +
      `E2E_REDLINE_EVALUATION_ID=${seeded.data.evaluationId}\n`,
  );
};

await main();
