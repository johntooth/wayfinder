import type { ConversationalNodeConfig, FlowNode } from "./flow-node";
import type { FlowTestSeed, SeedContextItem, SeedStepOutput } from "./flow-test-fixture";
import { nodeFieldSet } from "./node-output";
import type { StepOutputField } from "./session-step-output";
import type { TemplateField } from "./template-field";
import { validateTemplateFieldValue } from "./template-field";

// One seeded value that will not be written, and why. Rejects are reported to
// the author rather than dropped: a generated seed that quietly substitutes a
// legal value for an illegal one makes a broken step look sound, and a cloned
// seed pointing at a deleted node should say so rather than vanish (ADR-048).
export interface SeedReject {
  nodeId: string;
  key: string;
  value: string;
  reason: string;
}

export interface SeedValidation {
  // The seed as it will actually be materialised — values canonicalised, every
  // reject removed.
  accepted: FlowTestSeed;
  rejects: SeedReject[];
}

const fieldsOf = (node: FlowNode): TemplateField[] =>
  nodeFieldSet(node.config as unknown as ConversationalNodeConfig);

const validateContextItem = (
  item: SeedContextItem,
  nodeIds: Set<string>,
): SeedReject | null => {
  if (!nodeIds.has(item.nodeId)) {
    return {
      nodeId: item.nodeId,
      key: item.key,
      value: item.value,
      reason: "This step is no longer in this flow, so its context cannot be seeded.",
    };
  }
  if (item.key.trim() === "") {
    return {
      nodeId: item.nodeId,
      key: item.key,
      value: item.value,
      reason: "A gathered-context item with a blank key would never be read back.",
    };
  }
  return null;
};

const validateStepOutput = (
  stepOutput: SeedStepOutput,
  nodesById: Map<string, FlowNode>,
): { accepted: SeedStepOutput | null; rejects: SeedReject[] } => {
  const node = nodesById.get(stepOutput.nodeId);
  if (!node) {
    const rejects = stepOutput.fields.map((field) => ({
      nodeId: stepOutput.nodeId,
      key: field.key,
      value: field.value,
      reason: "This step is no longer in this flow, so its values cannot be seeded.",
    }));
    return { accepted: null, rejects };
  }

  const declared = new Map(fieldsOf(node).map((field) => [field.key, field]));
  const accepted: StepOutputField[] = [];
  const rejects: SeedReject[] = [];

  for (const field of stepOutput.fields) {
    const declaredField = declared.get(field.key);
    if (!declaredField) {
      rejects.push({
        nodeId: stepOutput.nodeId,
        key: field.key,
        value: field.value,
        reason: `"${node.name}" does not declare a field with this key.`,
      });
      continue;
    }

    const validated = validateTemplateFieldValue(declaredField, field.value);
    if (validated.error) {
      rejects.push({
        nodeId: stepOutput.nodeId,
        key: field.key,
        value: field.value,
        reason: validated.error.message,
      });
      continue;
    }

    accepted.push({ ...field, value: validated.data });
  }

  // An empty step output would write a row asserting the step produced nothing,
  // which is a different claim from "this step was not seeded".
  if (accepted.length === 0) return { accepted: null, rejects };
  return { accepted: { nodeId: stepOutput.nodeId, fields: accepted }, rejects };
};

// Pure: given a seed and the draft's nodes, split it into what can be written
// and what cannot. Never throws and never substitutes — an illegal value comes
// back as a reject carrying the same message the operator-facing validator would
// have produced, so the author reads one vocabulary for both.
export const validateSeedAgainstNodes = (
  seed: FlowTestSeed,
  nodes: FlowNode[],
): SeedValidation => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());

  const rejects: SeedReject[] = [];
  const gatheredContext: SeedContextItem[] = [];

  for (const item of seed.gatheredContext) {
    const reject = validateContextItem(item, nodeIds);
    if (reject) {
      rejects.push(reject);
      continue;
    }
    gatheredContext.push(item);
  }

  const stepOutputs: SeedStepOutput[] = [];
  for (const stepOutput of seed.stepOutputs) {
    const validated = validateStepOutput(stepOutput, nodesById);
    rejects.push(...validated.rejects);
    if (validated.accepted) stepOutputs.push(validated.accepted);
  }

  return { accepted: { gatheredContext, stepOutputs }, rejects };
};
