import type { ProviderName } from "@rbrasier/domain";

// Newer model families reject the sampling parameters older ones accepted —
// Claude 5 answers a `temperature` with "`temperature` is deprecated for this
// model", which fails the whole call. Two defences work together:
//
//   1. `supportsTemperature` withholds the parameter from families already known
//      to refuse it, so the common case never pays for a failed round trip.
//   2. `isUnsupportedParameterError` recognises the refusal at runtime, letting
//      the adapter retry once without the parameter and remember the answer via
//      `noteTemperatureUnsupported`. That is what keeps a model released after
//      this code was written working rather than erroring.

const TEMPERATURE_UNSUPPORTED_MODELS: readonly RegExp[] = [
  // Claude 5 family, direct and through Bedrock's prefixed ids
  // ("us.anthropic.claude-opus-5-v1:0").
  /claude-(opus|sonnet|haiku)-5\b/,
  // OpenAI reasoning models (o1/o3/o4…) and the GPT-5 family.
  /^o\d+(-|$)/,
  /^gpt-5(-|$)/,
];

// Models discovered to refuse temperature at runtime. Process-local: a restart
// simply rediscovers them at the cost of one failed call per model.
const discoveredUnsupported = new Set<string>();

const cacheKey = (provider: ProviderName, model: string): string => `${provider}:${model}`;

export const resetTemperatureSupportCache = (): void => {
  discoveredUnsupported.clear();
};

export const noteTemperatureUnsupported = (provider: ProviderName, model: string): void => {
  discoveredUnsupported.add(cacheKey(provider, model.toLowerCase()));
};

export const supportsTemperature = (
  provider: ProviderName,
  model: string | undefined,
): boolean => {
  if (!model) return true;
  const normalised = model.toLowerCase();
  if (discoveredUnsupported.has(cacheKey(provider, normalised))) return false;
  return !TEMPERATURE_UNSUPPORTED_MODELS.some((pattern) => pattern.test(normalised));
};

// Wording differs per provider, so match on "this parameter is not acceptable"
// phrasing near the parameter name rather than on any one provider's exact text.
const REFUSAL_HINTS: readonly string[] = [
  "is deprecated",
  "unsupported parameter",
  "unsupported value",
  "does not support",
  "is not supported",
  "unrecognized request argument",
  "unknown parameter",
  "extra inputs are not permitted",
];

const errorText = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return "";
  const candidate = error as { message?: unknown; responseBody?: unknown };
  const parts = [candidate.message, candidate.responseBody]
    .filter((part): part is string => typeof part === "string");
  return parts.join(" ").toLowerCase();
};

export const isUnsupportedParameterError = (error: unknown, parameter: string): boolean => {
  const text = errorText(error);
  if (!text.includes(parameter.toLowerCase())) return false;
  return REFUSAL_HINTS.some((hint) => text.includes(hint));
};
