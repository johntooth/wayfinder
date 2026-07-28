import {
  domainError,
  err,
  ok,
  type AiConfig,
  type AiPurpose,
  type GenerateObjectInput,
  type GenerateTextInput,
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
// failing outright (`temperature` is deprecated on the Claude 5 family).
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
  ) {}

  private runGoverned<R>(call: () => Promise<R>): Promise<R> {
    return this.governor ? this.governor.run(call) : call();
  }

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage }>> {
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const { provider, model, credentials } = resolveForCall(config, input.model, input.purpose);
      const result = await withTemperatureFallback(
        provider,
        model,
        input.temperature,
        (temperature) =>
          this.runGoverned(() =>
            generateObject({
              model: resolveModel(provider, model, credentials),
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
      return err(domainError("AI_PROVIDER_FAILED", "generateObject failed.", cause));
    }
  }

  async generateText(
    input: GenerateTextInput,
  ): Promise<Result<{ text: string; usage: TokenUsage }>> {
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const { provider, model, credentials } = resolveForCall(config, input.model, input.purpose);
      const result = await withTemperatureFallback(
        provider,
        model,
        input.temperature,
        (temperature) =>
          this.runGoverned(() =>
            generateText({
              model: resolveModel(provider, model, credentials),
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
      return err(domainError("AI_PROVIDER_FAILED", "generateText failed.", cause));
    }
  }

  async streamText(
    input: StreamTextInput,
  ): Promise<Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> }>> {
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const { provider, model, credentials } = resolveForCall(config, input.model, input.purpose);
      const result = streamText({
        model: resolveModel(provider, model, credentials),
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
        temperature: supportsTemperature(provider, model) ? input.temperature : undefined,
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
        textStream: observingTextStream(result.textStream, (error) =>
          recordTemperatureRefusal(provider, model, error),
        ),
        usage,
      });
    } catch (cause) {
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
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const { provider, model, credentials } = resolveForCall(config, input.model, input.purpose);
      const result = streamObject({
        model: resolveModel(provider, model, credentials),
        schema: input.schema as never,
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
        temperature: supportsTemperature(provider, model) ? input.temperature : undefined,
        maxTokens: input.maxTokens,
        onError: (event) => {
          recordTemperatureRefusal(provider, model, event.error);
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
      return err(domainError("AI_PROVIDER_FAILED", "streamObject failed.", cause));
    }
  }
}
