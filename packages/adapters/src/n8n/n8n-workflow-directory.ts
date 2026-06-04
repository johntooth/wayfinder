import {
  domainError,
  err,
  ok,
  type IN8nWorkflowDirectory,
  type N8nConfig,
  type N8nTrigger,
  type N8nWorkflowSummary,
  type Result,
  type TemplateField,
  type TemplateFieldType,
} from "@rbrasier/domain";

interface N8nNode {
  name?: string;
  type?: string;
  parameters?: Record<string, unknown>;
}

interface N8nWorkflow {
  id?: string;
  name?: string;
  active?: boolean;
  nodes?: N8nNode[];
}

const WEBHOOK_TYPE = "n8n-nodes-base.webhook";
const SET_TYPE = "n8n-nodes-base.set";
const RESPOND_TYPE = "n8n-nodes-base.respondToWebhook";
const PAGE_LIMIT = 250;
const MAX_PAGES = 50;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mapFieldType = (n8nType: unknown): TemplateFieldType => {
  switch (n8nType) {
    case "number":
      return "number";
    case "boolean":
      return "yesno";
    case "dateTime":
    case "date":
      return "date";
    default:
      return "text";
  }
};

const buildField = (name: unknown, n8nType: unknown): TemplateField | null => {
  if (typeof name !== "string") return null;
  const label = name.trim();
  if (!label) return null;
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) return null;
  return { key, label, type: mapFieldType(n8nType), optional: false, raw: label };
};

// n8n's "Edit Fields (Set)" node: v3.4+ stores `parameters.assignments.assignments`
// as `[{ name, type, value }]`; older versions store `parameters.values` keyed by
// type. Both are read best-effort.
const fieldsFromSetNode = (node: N8nNode): TemplateField[] => {
  const parameters = node.parameters ?? {};
  const fields: TemplateField[] = [];

  const assignments = isObject(parameters.assignments) ? parameters.assignments.assignments : undefined;
  if (Array.isArray(assignments)) {
    for (const assignment of assignments) {
      if (!isObject(assignment)) continue;
      const field = buildField(assignment.name, assignment.type);
      if (field) fields.push(field);
    }
    return fields;
  }

  const values = parameters.values;
  if (isObject(values)) {
    for (const [n8nType, entries] of Object.entries(values)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!isObject(entry)) continue;
        const field = buildField(entry.name, n8nType);
        if (field) fields.push(field);
      }
    }
  }
  return fields;
};

const fieldsFromRespondNode = (node: N8nNode): TemplateField[] => {
  const body = node.parameters?.responseBody;
  if (typeof body !== "string") return [];
  try {
    const parsed = JSON.parse(body);
    if (!isObject(parsed)) return [];
    return Object.keys(parsed)
      .map((key) => buildField(key, typeof parsed[key]))
      .filter((field): field is TemplateField => field !== null);
  } catch {
    return [];
  }
};

const findSetNode = (nodes: N8nNode[], named: RegExp): N8nNode | undefined =>
  nodes.find((node) => node.type === SET_TYPE && typeof node.name === "string" && named.test(node.name));

const firstSetNode = (nodes: N8nNode[]): N8nNode | undefined =>
  nodes.find((node) => node.type === SET_TYPE);

const resolveTrigger = (
  nodes: N8nNode[],
  baseUrl: string,
): { trigger: N8nTrigger; webhookUrl: string | null } => {
  const webhook = nodes.find((node) => node.type === WEBHOOK_TYPE);
  if (!webhook) {
    return { trigger: { kind: "manual_or_scheduled" }, webhookUrl: null };
  }
  const parameters = webhook.parameters ?? {};
  const method = typeof parameters.httpMethod === "string" ? parameters.httpMethod : "GET";
  const path = typeof parameters.path === "string" ? parameters.path : "";
  const authentication =
    typeof parameters.authentication === "string" ? parameters.authentication : "none";
  return {
    trigger: { kind: "webhook", method, path, authentication },
    webhookUrl: path ? `${baseUrl}/webhook/${path}` : null,
  };
};

const toSummary = (workflow: N8nWorkflow, baseUrl: string): N8nWorkflowSummary | null => {
  if (typeof workflow.id !== "string") return null;
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const { trigger, webhookUrl } = resolveTrigger(nodes, baseUrl);

  const inputsNode = findSetNode(nodes, /^inputs?$/i) ?? firstSetNode(nodes);
  const inputs = inputsNode ? fieldsFromSetNode(inputsNode) : [];

  const outputsSetNode = findSetNode(nodes, /^outputs?$/i);
  const respondNode = nodes.find((node) => node.type === RESPOND_TYPE);
  const outputs = outputsSetNode
    ? fieldsFromSetNode(outputsSetNode)
    : respondNode
      ? fieldsFromRespondNode(respondNode)
      : [];

  return {
    id: workflow.id,
    name: typeof workflow.name === "string" ? workflow.name : workflow.id,
    active: workflow.active === true,
    trigger,
    webhookUrl,
    inputs,
    outputs,
  };
};

export class N8nHttpWorkflowDirectory implements IN8nWorkflowDirectory {
  constructor(
    private readonly getConfig: () => Promise<N8nConfig>,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async listWorkflows(): Promise<Result<N8nWorkflowSummary[]>> {
    const config = await this.getConfig();
    if (!config.baseUrl || !config.apiKey) {
      return err(domainError("VALIDATION_FAILED", "n8n is not configured. Add an instance in admin settings."));
    }

    const summaries: N8nWorkflowSummary[] = [];
    let cursor: string | null = null;

    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL(`${config.baseUrl}/api/v1/workflows`);
        url.searchParams.set("limit", String(PAGE_LIMIT));
        if (cursor) url.searchParams.set("cursor", cursor);

        const response = await this.fetchFn(url.toString(), {
          headers: { "X-N8N-API-KEY": config.apiKey, Accept: "application/json" },
        });
        if (!response.ok) {
          return err(domainError("INFRA_FAILURE", `n8n API returned ${response.status}.`));
        }

        const payload = (await response.json()) as { data?: unknown; nextCursor?: unknown };
        const data = Array.isArray(payload.data) ? payload.data : [];
        for (const workflow of data) {
          if (!isObject(workflow)) continue;
          const summary = toSummary(workflow as N8nWorkflow, config.baseUrl);
          if (summary) summaries.push(summary);
        }

        cursor = typeof payload.nextCursor === "string" && payload.nextCursor.length > 0 ? payload.nextCursor : null;
        if (!cursor) break;
      }
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to reach the n8n API.", cause));
    }

    return ok(summaries);
  }
}
