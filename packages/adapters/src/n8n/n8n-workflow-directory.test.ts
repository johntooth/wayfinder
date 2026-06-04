import { describe, expect, it, vi } from "vitest";
import type { N8nConfig } from "@rbrasier/domain";
import { N8nHttpWorkflowDirectory } from "./n8n-workflow-directory";

const config: N8nConfig = { baseUrl: "https://n8n.example.com", apiKey: "secret-key" };

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: async () => body,
  }) as unknown as Response;

const webhookWorkflow = {
  id: "wf-1",
  name: "Vendor lookup",
  active: true,
  nodes: [
    {
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      parameters: { httpMethod: "POST", path: "vendor-lookup", authentication: "headerAuth" },
    },
    {
      name: "Inputs",
      type: "n8n-nodes-base.set",
      parameters: {
        assignments: {
          assignments: [
            { name: "category", type: "string" },
            { name: "budget", type: "number" },
          ],
        },
      },
    },
    {
      name: "Respond to Webhook",
      type: "n8n-nodes-base.respondToWebhook",
      parameters: { responseBody: '{"vendor":"Acme","approved":true}' },
    },
  ],
};

describe("N8nHttpWorkflowDirectory", () => {
  it("maps a webhook trigger to method/path/auth and a derived webhook URL", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [webhookWorkflow], nextCursor: null }));
    const directory = new N8nHttpWorkflowDirectory(async () => config, fetchFn as unknown as typeof fetch);

    const result = await directory.listWorkflows();

    expect(result.error).toBeUndefined();
    const summary = result.data![0]!;
    expect(summary.id).toBe("wf-1");
    expect(summary.trigger).toEqual({
      kind: "webhook",
      method: "POST",
      path: "vendor-lookup",
      authentication: "headerAuth",
    });
    expect(summary.webhookUrl).toBe("https://n8n.example.com/webhook/vendor-lookup");
  });

  it("derives inputs from an Inputs Set node and outputs from respondToWebhook", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [webhookWorkflow], nextCursor: null }));
    const directory = new N8nHttpWorkflowDirectory(async () => config, fetchFn as unknown as typeof fetch);

    const summary = (await directory.listWorkflows()).data![0]!;

    expect(summary.inputs).toEqual([
      { key: "category", label: "category", type: "text", optional: false, raw: "category" },
      { key: "budget", label: "budget", type: "number", optional: false, raw: "budget" },
    ]);
    expect(summary.outputs).toEqual([
      { key: "vendor", label: "vendor", type: "text", optional: false, raw: "vendor" },
      { key: "approved", label: "approved", type: "yesno", optional: false, raw: "approved" },
    ]);
  });

  it("prefers an Outputs Set node over respondToWebhook for outputs", async () => {
    const workflow = {
      id: "wf-2",
      name: "With outputs node",
      nodes: [
        { name: "Webhook", type: "n8n-nodes-base.webhook", parameters: { path: "p" } },
        {
          name: "Outputs",
          type: "n8n-nodes-base.set",
          parameters: { assignments: { assignments: [{ name: "status", type: "string" }] } },
        },
        { name: "Respond", type: "n8n-nodes-base.respondToWebhook", parameters: { responseBody: '{"ignored":1}' } },
      ],
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [workflow], nextCursor: null }));
    const directory = new N8nHttpWorkflowDirectory(async () => config, fetchFn as unknown as typeof fetch);

    const summary = (await directory.listWorkflows()).data![0]!;
    expect(summary.outputs).toEqual([
      { key: "status", label: "status", type: "text", optional: false, raw: "status" },
    ]);
  });

  it("marks manual/scheduled triggers and yields no webhook URL", async () => {
    const workflow = {
      id: "wf-3",
      name: "Scheduled",
      nodes: [{ name: "Schedule Trigger", type: "n8n-nodes-base.scheduleTrigger", parameters: {} }],
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [workflow], nextCursor: null }));
    const directory = new N8nHttpWorkflowDirectory(async () => config, fetchFn as unknown as typeof fetch);

    const summary = (await directory.listWorkflows()).data![0]!;
    expect(summary.trigger).toEqual({ kind: "manual_or_scheduled" });
    expect(summary.webhookUrl).toBeNull();
  });

  it("returns empty input/output lists for a workflow with no recognised nodes, without throwing", async () => {
    const workflow = { id: "wf-4", name: "Bare", nodes: [{ name: "NoOp", type: "n8n-nodes-base.noOp" }] };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [workflow], nextCursor: null }));
    const directory = new N8nHttpWorkflowDirectory(async () => config, fetchFn as unknown as typeof fetch);

    const summary = (await directory.listWorkflows()).data![0]!;
    expect(summary.inputs).toEqual([]);
    expect(summary.outputs).toEqual([]);
    expect(summary.trigger).toEqual({ kind: "manual_or_scheduled" });
  });

  it("follows pagination via nextCursor", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [webhookWorkflow], nextCursor: "abc" }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ ...webhookWorkflow, id: "wf-2" }], nextCursor: null }));
    const directory = new N8nHttpWorkflowDirectory(async () => config, fetchFn as unknown as typeof fetch);

    const result = await directory.listWorkflows();
    expect(result.data).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[1]![0] as string)).toContain("cursor=abc");
  });

  it("sends the API key header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [], nextCursor: null }));
    const directory = new N8nHttpWorkflowDirectory(async () => config, fetchFn as unknown as typeof fetch);

    await directory.listWorkflows();
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-N8N-API-KEY"]).toBe("secret-key");
  });

  it("returns a validation error when n8n is not configured", async () => {
    const directory = new N8nHttpWorkflowDirectory(async () => ({ baseUrl: "", apiKey: "" }));
    const result = await directory.listWorkflows();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns an infra error on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false, 401));
    const directory = new N8nHttpWorkflowDirectory(async () => config, fetchFn as unknown as typeof fetch);

    const result = await directory.listWorkflows();
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("returns an infra error when the fetch throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const directory = new N8nHttpWorkflowDirectory(async () => config, fetchFn as unknown as typeof fetch);

    const result = await directory.listWorkflows();
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
