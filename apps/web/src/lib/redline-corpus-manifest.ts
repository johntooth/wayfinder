import { domainError, err, ok, type Result } from "@redline/redline-domain";
import type { ResponseGroupInput, VendorInput } from "@redline/redline-application";
import type { ClassificationLensDefinition } from "@redline/redline-domain";

// The corpus manifest — the operator's half of a corpus run (delivery-plan §2).
// The served grouping page is read-only until the stage machine lands, so the
// vendors, the response groups and the lens have to be declared somewhere the
// operator controls. A JSON file beside the corpus is the cheapest honest answer.
//
// It is hand-written, so every rejection names the offending field: a stack
// trace from JSON.parse tells the operator nothing about which group is missing
// its documents.

export interface CorpusManifest {
  readonly evaluationId: string;
  readonly evaluationName: string;
  readonly lens: ClassificationLensDefinition;
  readonly vendors: readonly VendorInput[];
  readonly groups: readonly ResponseGroupInput[];
  // Every document across the groups, first-seen order, deduplicated. This is
  // what IngestDocuments verifies extraction for, and a document belongs to the
  // evaluation by virtue of being in a group — there is no second list to keep
  // in step.
  readonly documentIds: readonly string[];
}

const invalid = (message: string) => err(domainError("VALIDATION_FAILED", message));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (source: Record<string, unknown>, field: string, path: string): Result<string> => {
  const value = source[field];
  if (typeof value !== "string" || value.trim() === "") {
    return invalid(`${path}${field} must be a non-empty string`);
  }
  return ok(value);
};

const readArray = (source: Record<string, unknown>, field: string, path: string): Result<unknown[]> => {
  const value = source[field];
  if (!Array.isArray(value)) return invalid(`${path}${field} must be an array`);
  return ok(value);
};

const readStringArray = (
  source: Record<string, unknown>,
  field: string,
  path: string,
): Result<string[]> => {
  const value = readArray(source, field, path);
  if (value.error) return value;

  const strings = value.data.filter((entry): entry is string => typeof entry === "string");
  if (strings.length !== value.data.length) {
    return invalid(`${path}${field} must contain only strings`);
  }
  return ok(strings);
};

const readTopics = (lens: Record<string, unknown>): Result<ClassificationLensDefinition["topics"]> => {
  const rawTopics = readArray(lens, "topics", "lens.");
  if (rawTopics.error) return rawTopics;
  if (rawTopics.data.length === 0) return invalid("lens.topics must declare at least one topic");

  const topics: { id: string; name: string; definition: string }[] = [];
  for (const [index, raw] of rawTopics.data.entries()) {
    if (!isRecord(raw)) return invalid(`lens.topics[${index}] must be an object`);
    const path = `lens.topics[${index}].`;

    const id = readString(raw, "id", path);
    if (id.error) return id;
    const name = readString(raw, "name", path);
    if (name.error) return name;
    const definition = readString(raw, "definition", path);
    if (definition.error) return definition;

    topics.push({ id: id.data, name: name.data, definition: definition.data });
  }
  return ok(topics);
};

const readRules = (lens: Record<string, unknown>): Result<ClassificationLensDefinition["rules"]> => {
  const rawRules = readArray(lens, "rules", "lens.");
  if (rawRules.error) return rawRules;

  const rules: { id: string; pattern: string; topicId: string }[] = [];
  for (const [index, raw] of rawRules.data.entries()) {
    if (!isRecord(raw)) return invalid(`lens.rules[${index}] must be an object`);
    const path = `lens.rules[${index}].`;

    const id = readString(raw, "id", path);
    if (id.error) return id;
    const pattern = readString(raw, "pattern", path);
    if (pattern.error) return pattern;
    const topicId = readString(raw, "topicId", path);
    if (topicId.error) return topicId;

    rules.push({ id: id.data, pattern: pattern.data, topicId: topicId.data });
  }
  return ok(rules);
};

const readLens = (
  manifest: Record<string, unknown>,
  evaluationId: string,
): Result<ClassificationLensDefinition> => {
  const raw = manifest["lens"];
  if (!isRecord(raw)) return invalid("lens must be an object");

  const lensId = readString(raw, "lensId", "lens.");
  if (lensId.error) return lensId;
  const name = readString(raw, "name", "lens.");
  if (name.error) return name;

  const topics = readTopics(raw);
  if (topics.error) return topics;
  const rules = readRules(raw);
  if (rules.error) return rules;

  return ok({ lensId: lensId.data, name: name.data, evaluationId, topics: topics.data, rules: rules.data });
};

const readVendors = (manifest: Record<string, unknown>): Result<VendorInput[]> => {
  const rawVendors = readArray(manifest, "vendors", "");
  if (rawVendors.error) return rawVendors;
  if (rawVendors.data.length === 0) return invalid("vendors must declare at least one vendor");

  const vendors: VendorInput[] = [];
  for (const [index, raw] of rawVendors.data.entries()) {
    if (!isRecord(raw)) return invalid(`vendors[${index}] must be an object`);
    const path = `vendors[${index}].`;

    const id = readString(raw, "id", path);
    if (id.error) return id;
    const displayName = readString(raw, "displayName", path);
    if (displayName.error) return displayName;

    if (raw["isConsortium"] !== true) {
      vendors.push({ id: id.data, displayName: displayName.data });
      continue;
    }

    const memberVendorIds = readStringArray(raw, "memberVendorIds", path);
    if (memberVendorIds.error) return memberVendorIds;
    vendors.push({
      id: id.data,
      displayName: displayName.data,
      isConsortium: true,
      memberVendorIds: memberVendorIds.data,
    });
  }
  return ok(vendors);
};

const readGroups = (
  manifest: Record<string, unknown>,
  vendorIds: ReadonlySet<string>,
): Result<ResponseGroupInput[]> => {
  const rawGroups = readArray(manifest, "groups", "");
  if (rawGroups.error) return rawGroups;
  if (rawGroups.data.length === 0) return invalid("groups must declare at least one response group");

  const groups: ResponseGroupInput[] = [];
  for (const [index, raw] of rawGroups.data.entries()) {
    if (!isRecord(raw)) return invalid(`groups[${index}] must be an object`);

    const group = readGroup(raw, index, vendorIds);
    if (group.error) return group;
    groups.push(group.data);
  }
  return ok(groups);
};

const readGroup = (
  raw: Record<string, unknown>,
  index: number,
  vendorIds: ReadonlySet<string>,
): Result<ResponseGroupInput> => {
  const path = `groups[${index}].`;

  const id = readString(raw, "id", path);
  if (id.error) return id;
  const label = readString(raw, "label", path);
  if (label.error) return label;

  const groupVendorIds = readStringArray(raw, "vendorIds", path);
  if (groupVendorIds.error) return groupVendorIds;

  const unknownVendor = groupVendorIds.data.find((vendorId) => !vendorIds.has(vendorId));
  if (unknownVendor) {
    return invalid(`group ${id.data} references vendor ${unknownVendor}, which the manifest does not declare`);
  }

  const documentIds = readStringArray(raw, "documentIds", path);
  if (documentIds.error) return documentIds;
  if (documentIds.data.length === 0) {
    return invalid(`group ${id.data} must list at least one document`);
  }

  return ok({ id: id.data, label: label.data, vendorIds: groupVendorIds.data, documentIds: documentIds.data });
};

// A document belongs to exactly one response group. Nothing downstream enforces
// this — AssignDocumentsToGroups takes the groups as given — so a manifest
// claiming one document twice would classify it under both, double-counting its
// pricing in the pivots. This parser is the only place the invariant holds.
const collectDocumentIds = (groups: readonly ResponseGroupInput[]): Result<string[]> => {
  const claimedBy = new Map<string, string>();
  for (const group of groups) {
    for (const documentId of group.documentIds) {
      const owner = claimedBy.get(documentId);
      if (owner !== undefined) {
        return invalid(`document ${documentId} is claimed by both group ${owner} and group ${group.id}`);
      }
      claimedBy.set(documentId, group.id);
    }
  }
  return ok([...claimedBy.keys()]);
};

export const parseCorpusManifest = (source: unknown): Result<CorpusManifest> => {
  if (!isRecord(source)) return invalid("the manifest must be a JSON object");

  const evaluationId = readString(source, "evaluationId", "");
  if (evaluationId.error) return evaluationId;
  const evaluationName = readString(source, "evaluationName", "");
  if (evaluationName.error) return evaluationName;

  const lens = readLens(source, evaluationId.data);
  if (lens.error) return lens;

  const vendors = readVendors(source);
  if (vendors.error) return vendors;

  const groups = readGroups(source, new Set(vendors.data.map((vendor) => vendor.id)));
  if (groups.error) return groups;

  const documentIds = collectDocumentIds(groups.data);
  if (documentIds.error) return documentIds;

  return ok({
    evaluationId: evaluationId.data,
    evaluationName: evaluationName.data,
    lens: lens.data,
    vendors: vendors.data,
    groups: groups.data,
    documentIds: documentIds.data,
  });
};
