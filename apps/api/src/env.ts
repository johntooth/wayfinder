import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().url(),
  N8N_WEBHOOK_SECRET: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.enum(["anthropic", "openai", "mistral", "bedrock"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  AWS_BEDROCK_REGION: z.string().optional(),
  AWS_BEDROCK_ACCESS_KEY_ID: z.string().optional(),
  AWS_BEDROCK_SECRET_ACCESS_KEY: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default("template-api"),
  // The in-process scheduler tick loop runs in this long-lived API server.
  // Disabled only by an explicit "false" so it is on by default.
  SCHEDULER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (): Env => {
  // Shell `source .env` exports empty-value lines (e.g. OTEL_EXPORTER_OTLP_ENDPOINT=)
  // as empty strings. Zod treats "" as a provided string and fails .url() validation.
  // Strip empty strings to undefined so optional URL fields behave as unset.
  const env = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  return envSchema.parse(env);
};
