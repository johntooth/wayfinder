import {
  domainError,
  err,
  ok,
  type AutoNodeConfig,
  type Flow,
  type FlowNode,
  type ILanguageModel,
  type INodeExecutor,
  type ISessionRepository,
  type NodeExecutionOutput,
  type Result,
  type Session,
  type SessionMessage,
} from "@rbrasier/domain";
import { extractStructuredFields } from "../document/structured-fields";

export interface RunAutoNodeInput {
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
  userId: string;
  userRole: "admin" | "user";
}

export interface RunAutoNodeOutput {
  correlationId: string;
  status: NodeExecutionOutput["status"];
  message?: string;
}

export interface RunAutoNodeClock {
  generateCorrelationId: () => string;
  now: () => Date;
}

const defaultClock: RunAutoNodeClock = {
  generateCorrelationId: () => globalThis.crypto.randomUUID(),
  now: () => new Date(),
};

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const buildTranscript = (messages: SessionMessage[]): string =>
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n")
    .slice(0, 8000);

export class RunAutoNode {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly languageModel: ILanguageModel,
    private readonly executor: INodeExecutor,
    private readonly clock: RunAutoNodeClock = defaultClock,
  ) {}

  async execute(input: RunAutoNodeInput): Promise<Result<RunAutoNodeOutput>> {
    const config = input.node.config as unknown as AutoNodeConfig;

    if (!config.webhookUrl) {
      return err(domainError("VALIDATION_FAILED", "Auto node has no webhook URL configured."));
    }

    const requestFields = config.requestFields ?? [];
    let fields: Record<string, string> = {};
    if (requestFields.length > 0) {
      const extracted = await extractStructuredFields(this.languageModel, {
        fields: requestFields,
        transcript: buildTranscript(input.messages),
        contextDocs: input.flow.contextDocs,
        instruction: config.instruction,
        purpose: "autoNodeFields",
      });
      if (extracted.error) return extracted;
      fields = extracted.data;
    }

    const correlationId = this.clock.generateCorrelationId();
    const sentAt = this.clock.now().toISOString();

    const recorded = await this.sessions.update(input.session.id, {
      pendingExecutions: {
        ...input.session.pendingExecutions,
        [correlationId]: { nodeId: input.node.id, status: "pending", sentAt },
      },
    });
    if (recorded.error) return recorded;

    const executed = await this.executor.execute({
      nodeId: input.node.id,
      sessionId: input.session.id,
      userId: input.userId,
      userRole: input.userRole,
      flowId: input.flow.id,
      flowSlug: slugify(input.flow.name),
      sessionTitle: input.session.title ?? "",
      instruction: config.instruction,
      correlationId,
      webhookUrl: config.webhookUrl,
      fields,
    });
    if (executed.error) return executed;

    return ok({
      correlationId,
      status: executed.data.status,
      message: executed.data.message,
    });
  }
}
