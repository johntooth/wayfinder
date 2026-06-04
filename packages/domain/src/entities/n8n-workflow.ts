import type { TemplateField } from "./template-field";

export interface N8nWebhookTrigger {
  kind: "webhook";
  method: string;
  path: string;
  authentication: string;
}

export interface N8nManualOrScheduledTrigger {
  kind: "manual_or_scheduled";
}

export type N8nTrigger = N8nWebhookTrigger | N8nManualOrScheduledTrigger;

// A workflow mapped from the n8n REST API into the shape Wayfinder needs: a
// dropdown label, the trigger metadata, a derived webhook URL (webhook triggers
// only), and best-effort input/output field schemas inferred by convention.
export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  trigger: N8nTrigger;
  webhookUrl: string | null;
  inputs: TemplateField[];
  outputs: TemplateField[];
}
