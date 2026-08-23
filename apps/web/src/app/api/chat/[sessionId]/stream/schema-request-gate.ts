import {
  proposedFieldsFromToolArguments,
  type McpToolCallRecord,
  type PendingSchemaRequest,
} from "@rbrasier/domain";

const DEFAULT_PROMPT = "Define the fields this report should capture.";

// The tool call that suspends the turn, or null when this step does not use one.
// The tool is named by the node's config rather than hardcoded, so a flow that
// never asks for a schema is entirely unaffected (JOHNS-PLAN §1).
export const findSchemaRequestCall = (
  toolCalls: readonly McpToolCallRecord[],
  configuredToolName: string | undefined,
): McpToolCallRecord | null => {
  const wanted = configuredToolName?.trim();
  if (!wanted) return null;
  return toolCalls.find((toolCall) => toolCall.toolName === wanted) ?? null;
};

// The call's own result is deliberately ignored: the operator's submission is
// the answer, and the tool's return value would only be a paraphrase of what the
// form is about to collect properly.
export const buildPendingSchemaRequest = (toolCall: McpToolCallRecord): PendingSchemaRequest => {
  let prompt = "";
  try {
    const parsed = JSON.parse(toolCall.arguments) as { prompt?: unknown; reason?: unknown } | null;
    const candidate = parsed?.prompt ?? parsed?.reason;
    if (typeof candidate === "string") prompt = candidate.trim();
  } catch {
    prompt = "";
  }

  return {
    toolName: toolCall.toolName,
    prompt: prompt.length > 0 ? prompt : DEFAULT_PROMPT,
    proposedFields: proposedFieldsFromToolArguments(toolCall.arguments),
    status: "pending",
  };
};
