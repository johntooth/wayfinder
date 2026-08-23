import {
  domainError,
  err,
  ok,
  parseSchemaRequestSubmission,
  type IAuditLogger,
  type ISessionMessageRepository,
  type PendingSchemaRequest,
  type Result,
  type SchemaRequestField,
  type SchemaRequestFieldDraft,
} from "@rbrasier/domain";

export interface SubmitSchemaRequestInput {
  messageId: string;
  userId: string;
  fields: SchemaRequestFieldDraft[];
}

export interface DismissSchemaRequestInput {
  messageId: string;
  userId: string;
}

export interface ResolveSchemaRequestOutput {
  fields: SchemaRequestField[];
}

const describeField = (field: SchemaRequestField): string => {
  const parts = [`${field.label} (${field.type}${field.required ? "" : ", optional"})`];
  if (field.options.length > 0) parts.push(`choices: ${field.options.join(", ")}`);
  if (field.instruction.length > 0) parts.push(field.instruction);
  return `- ${parts.join(" — ")}`;
};

// Answers an AI-triggered schema-definition request (JOHNS-PLAN §1). The
// submitted schema is the definition of what the report claims to be, so it is
// workflow state: it is persisted against the message, audited, and restated as
// a system message so the next turn reads it from the transcript rather than
// having to be told separately.
export class ResolveSchemaRequest {
  constructor(
    private readonly messages: ISessionMessageRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async submit(input: SubmitSchemaRequestInput): Promise<Result<ResolveSchemaRequestOutput>> {
    const pending = await this.loadPending(input.messageId);
    if (pending.error) return pending;

    // Validated before anything is written, so a rejected submission leaves the
    // request pending and the operator's form still answerable.
    const fields = parseSchemaRequestSubmission(input.fields);
    if (fields.error) return fields;

    const resolved: PendingSchemaRequest = {
      ...pending.data.request,
      status: "submitted",
      fields: fields.data,
      resolvedAt: new Date().toISOString(),
      resolvedByUserId: input.userId,
    };

    const written = await this.messages.updateSchemaRequest(input.messageId, resolved);
    if (written.error) return written;

    await this.auditLogger.log({
      actorId: input.userId,
      action: "session.schema_defined",
      resourceType: "session",
      resourceId: pending.data.sessionId,
      metadata: {
        messageId: input.messageId,
        toolName: pending.data.request.toolName,
        fieldCount: fields.data.length,
        fieldKeys: fields.data.map((field) => field.key),
      },
    });

    await this.messages.create({
      sessionId: pending.data.sessionId,
      role: "system",
      content: `Report schema defined by the operator:\n${fields.data.map(describeField).join("\n")}`,
      stepNodeId: pending.data.stepNodeId,
    });

    return ok({ fields: fields.data });
  }

  async dismiss(input: DismissSchemaRequestInput): Promise<Result<ResolveSchemaRequestOutput>> {
    const pending = await this.loadPending(input.messageId);
    if (pending.error) return pending;

    const resolved: PendingSchemaRequest = {
      ...pending.data.request,
      status: "dismissed",
      resolvedAt: new Date().toISOString(),
      resolvedByUserId: input.userId,
    };

    const written = await this.messages.updateSchemaRequest(input.messageId, resolved);
    if (written.error) return written;

    // Without this the operator is left on a step whose only prompt they just
    // dismissed — a thread with nothing to act on.
    await this.messages.create({
      sessionId: pending.data.sessionId,
      role: "system",
      content:
        "The schema form was dismissed. This step is still open — describe the fields you need in the chat, or ask to see the form again.",
      stepNodeId: pending.data.stepNodeId,
    });

    return ok({ fields: [] });
  }

  private async loadPending(
    messageId: string,
  ): Promise<Result<{ request: PendingSchemaRequest; sessionId: string; stepNodeId: string | null }>> {
    const found = await this.messages.findById(messageId);
    if (found.error) return found;
    if (!found.data?.schemaRequest) {
      return err(domainError("NOT_FOUND", "This message carries no schema request."));
    }
    if (found.data.schemaRequest.status !== "pending") {
      return err(domainError("VALIDATION_FAILED", "This schema request has already been answered."));
    }
    return ok({
      request: found.data.schemaRequest,
      sessionId: found.data.sessionId,
      stepNodeId: found.data.stepNodeId,
    });
  }
}
