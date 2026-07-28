import {
  domainError,
  err,
  ok,
  type AiConfig,
  type AiPurpose,
  type GenerateObjectInput,
  type GenerateTextInput,
  type IErrorLogger,
  type ILanguageModel,
  type ProviderName,
  type Result,
  type StreamObjectInput,
  type StreamTextInput,
  type TokenUsage,
} from "@rbrasier/domain";
import { generateObject, generateText, streamObject, streamText } from "ai";
import { resolveModel, type ProviderCredentials } from "./providers";
import { RuntimeConfigStore } from "../config/runtime-config-store";
import { LlmCallGovernor } from "./llm-concurrency";
import {
  isUnsupportedParameterError,
  noteTemperatureUnsupported,
  supportsTemperature,
} from "./sampling-params";

interface AnthropicMeta {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

const extractMeta = (
  providerMeta: Record<string, unknown> | undefined,
): Pick<TokenUsage, "cacheReadTokens" | "cacheWriteTokens"> => {
  const a = providerMeta?.["anthropic"] as AnthropicMeta | undefined;
  return {
    cacheReadTokens: a?.cacheReadInputTokens ?? 0,
    cacheWriteTokens: a?.cacheCreationInputTokens ?? 0,
  };
};

const KNOWN_PURPOSES = new Set<AiPurpose>(["chat", "documentGeneration", "branching"]);

const resolvePurpose = (raw: string): AiPurpose => {
  if ((KNOWN_PURPOSES as Set<string>).has(raw)) return raw as AiPurpose;
  if (raw.includes("document")) return "documentGeneration";
  if (raw.includes("branch")) return "branching";
  return "chat";
};

const resolveForCall = (
  config: AiConfig,
  inputModel: string | undefined,
  rawPurpose: string,
): { provider: ProviderName; model: string; credentials: ProviderCredentials } => {
  const provider = config.provider;
  const credentials = config.apiKeys[provider];
  const purpose = resolvePurpose(rawPurpose);
  const model = inputModel ?? config.models[purpose];
  return { provider, model, credentials };
};

// Runs a call with `temperature`, and — when the provider answers that the model
// does not accept it — records that and replays the call once without it. This
// is what keeps a model released after this code was written working instead of
// failing outright (`temperature` is deprecated on the Claude 5 family). A
// recovered call is not a failure — nothing is logged here; if the retry itself
// throws, that propagates to the caller's own catch block like any other error.
const withTemperatureFallback = async <R>(
  provider: ProviderName,
  model: string,
  temperature: number | undefined,
  call: (temperature: number | undefined) => Promise<R>,
): Promise<R> => {
  const initial = supportsTemperature(provider, model) ? temperature : undefined;
  try {
    return await call(initial);
  } catch (cause) {
    if (initial === undefined || !isUnsupportedParameterError(cause, "temperature")) throw cause;
    noteTemperatureUnsupported(provider, model);
    return await call(undefined);
  }
};

// Streaming calls cannot be replayed transparently — the result object is handed
// to decorators (usage tracking, tracing) the moment it is created. Instead the
// refusal is recorded as it goes past, so the next call on that model omits the
// parameter and succeeds.
const recordTemperatureRefusal = (
  provider: ProviderName,
  model: string,
  error: unknown,
): void => {
  if (!isUnsupportedParameterError(error, "temperature")) return;
  noteTemperatureUnsupported(provider, model);
};

async function* observingTextStream(
  stream: AsyncIterable<string>,
  onError: (error: unknown) => void,
): AsyncIterable<string> {
  try {
    for await (const chunk of stream) yield chunk;
  } catch (error) {
    onError(error);
    throw error;
  }
}

export class LanguageModelAdapter implements ILanguageModel {
  constructor(
    public readonly provider: ProviderName,
    private readonly runtimeConfig: RuntimeConfigStore,
    // Optional so existing single-instance/test wiring stays a plain provider
    // call; when supplied it bounds concurrency and retries transient failures.
    private readonly governor?: LlmCallGovernor,
    // Optional so existing wiring/tests are unaffected; when supplied, a call
    // that genuinely fails (returns AI_PROVIDER_FAILED, including when a
    // temperature refusal survives the retry in withTemperatureFallback) is
    // recorded to admin_errors. A call that recovers is not logged — only
    // failures the caller actually sees.
    private readonly errorLogger?: IErrorLogger,
  ) {}

  private runGoverned<R>(call: () => Promise<R>): Promise<R> {
    return this.governor ? this.governor.run(call) : call();
  }

  // Fire-and-forget: logging a failure must never throw into the Result it is
  // reporting on. IErrorLogger.log() never rejects on its own (it swallows its
  // own persistence failures to console), but the .catch stays as a backstop —
  // this runs from a catch block, so a rejection here would be unhandled.
  private logAiCallFailure(
    method: "generateObject" | "generateText" | "streamText" | "streamObject",
    provider: ProviderName | undefined,
    model: string | undefined,
    cause: unknown,
  ): void {
    if (!this.errorLogger) return;
    const detail = cause instanceof Error ? cause.message : String(cause);
    void this.errorLogger
      .log({
        level: "error",
        message: `LLM ${method} call failed${provider && model ? ` (${provider}:${model})` : ""}: ${detail}`,
        stack: cause instanceof Error ? (cause.stack ?? null) : null,
        page: "ai/language-model-adapter",
        metadata: { method, provider: provider ?? null, model: model ?? null },
      })
      .catch(() => {});
  }

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage }>> {
    let provider: ProviderName | undefined;
    let model: string | undefined;
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const resolved = resolveForCall(config, input.model, input.purpose);
      provider = resolved.provider;
      model = resolved.model;
      const result = await withTemperatureFallback(
        resolved.provider,
        resolved.model,
        input.temperature,
        (temperature) =>
          this.runGoverned(() =>
            generateObject({
              model: resolveModel(resolved.provider, resolved.model, resolved.credentials),
              schema: input.schema as never,
              system: input.system,
              prompt: input.prompt,
              messages: input.messages as never,
              temperature,
              maxTokens: input.maxTokens,
            }),
          ),
      );
      const meta = extractMeta(
        result.experimental_providerMetadata as Record<string, unknown> | undefined,
      );
      return ok({
        object: result.object as T,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          systemTokens: 0,
          ...meta,
        },
      });
    } catch (cause) {
      this.logAiCallFailure("generateObject", provider, model, cause);
      return err(domainError("AI_PROVIDER_FAILED", "generateObject failed.", cause));
    }
  }

  async generateText(
    input: GenerateTextInput,
  ): Promise<Result<{ text: string; usage: TokenUsage }>> {
    let provider: ProviderName | undefined;
    let model: string | undefined;
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const resolved = resolveForCall(config, input.model, input.purpose);
      provider = resolved.provider;
      model = resolved.model;
      const result = await withTemperatureFallback(
        resolved.provider,
        resolved.model,
        input.temperature,
        (temperature) =>
          this.runGoverned(() =>
            generateText({
              model: resolveModel(resolved.provider, resolved.model, resolved.credentials),
              system: input.system,
              prompt: input.prompt,
              messages: input.messages as never,
              temperature,
              maxTokens: input.maxTokens,
            }),
          ),
      );
      const meta = extractMeta(
        result.experimental_providerMetadata as Record<string, unknown> | undefined,
      );
      return ok({
        text: result.text,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          systemTokens: 0,
          ...meta,
        },
      });
    } catch (cause) {
      this.logAiCallFailure("generateText", provider, model, cause);
      return err(domainError("AI_PROVIDER_FAILED", "generateText failed.", cause));
    }
  }

  async streamText(
    input: StreamTextInput,
  ): Promise<Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> }>> {
    let provider: ProviderName | undefined;
    let model: string | undefined;
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const resolved = resolveForCall(config, input.model, input.purpose);
      provider = resolved.provider;
      model = resolved.model;
      const result = streamText({
        model: resolveModel(resolved.provider, resolved.model, resolved.credentials),
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
        temperature: supportsTemperature(resolved.provider, resolved.model)
          ? input.temperature
          : undefined,
        maxTokens: input.maxTokens,
      });
      const usage = result.usage.then((u) => ({
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        systemTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }));
      return ok({
        // A mid-stream failure here is not logged: the Result has already
        // resolved to ok(), so this is not the port reporting a genuine
        // failure — it is a broken stream the caller is already reading and,
        // for the chat path, already logs itself (route.ts's onError).
        // Logging it again here would duplicate that row.
        textStream: observingTextStream(result.textStream, (error) =>
          recordTemperatureRefusal(resolved.provider, resolved.model, error),
        ),
        usage,
      });
    } catch (cause) {
      this.logAiCallFailure("streamText", provider, model, cause);
      return err(domainError("AI_PROVIDER_FAILED", "streamText failed.", cause));
    }
  }

  async streamObject<T>(
    input: StreamObjectInput,
  ): Promise<
    Result<{
      partialObjectStream: AsyncIterable<Partial<T>>;
      object: Promise<T>;
      usage: Promise<TokenUsage>;
    }>
  > {
    let provider: ProviderName | undefined;
    let model: string | undefined;
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const resolved = resolveForCall(config, input.model, input.purpose);
      provider = resolved.provider;
      model = resolved.model;
      const result = streamObject({
        model: resolveModel(resolved.provider, resolved.model, resolved.credentials),
        schema: input.schema as never,
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
        temperature: supportsTemperature(resolved.provider, resolved.model)
          ? input.temperature
          : undefined,
        maxTokens: input.maxTokens,
        // Same reasoning as streamText's onError: a mid-stream failure here is
        // not logged — the Result already resolved to ok(), and callers of the
        // primary chat path already log this onError themselves (route.ts).
        onError: (event) => {
          recordTemperatureRefusal(resolved.provider, resolved.model, event.error);
          input.onError?.(event);
        },
      });
      // Await providerMetadata alongside usage so cache tokens survive the port
      // hop: without this the Anthropic prompt-cache readings are lost and every
      // cached turn reports zero cache tokens (double-counting spend caps).
      const usage = Promise.all([
        result.usage,
        result.providerMetadata as Promise<Record<string, unknown> | undefined>,
      ]).then(([u, meta]) => ({
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        systemTokens: 0,
        ...extractMeta(meta),
      }));
      return ok({
        partialObjectStream: result.partialObjectStream as AsyncIterable<Partial<T>>,
        object: result.object as Promise<T>,
        usage,
      });
    } catch (cause) {
      this.logAiCallFailure("streamObject", provider, model, cause);
      return err(domainError("AI_PROVIDER_FAILED", "streamObject failed.", cause));
    }
  }
}
