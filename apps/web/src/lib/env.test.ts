import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REQUIRED = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5433/wayfinder",
  BETTER_AUTH_SECRET: "b".repeat(32),
  SETTINGS_ENCRYPTION_KEY: "0".repeat(64),
};

// Every key the schema knows about, so a leftover value from the real process
// environment cannot mask a failure (or cause one).
const MANAGED_KEYS = [
  ...Object.keys(REQUIRED),
  "ADMIN_SEED_EMAIL",
  "SETUP_TOKEN",
  "BETTER_AUTH_URL",
  "LANGFUSE_HOST",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "SMTP_TRANSPORT_MODE",
  "SMTP_PORT",
  "MINIO_REGION",
  "MINIO_PATH_STYLE",
  "N8N_WEBHOOK_SECRET",
  "PKI_TRUSTED_PROXY_IPS",
];

// serverEnv() memoises, so each case needs a fresh module instance.
const loadServerEnv = async () => {
  vi.resetModules();
  const { serverEnv } = await import("./env");
  return serverEnv();
};

const setEnv = (values: Record<string, string | undefined>): void => {
  for (const key of MANAGED_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
};

describe("serverEnv", () => {
  beforeEach(() => {
    setEnv(REQUIRED);
  });

  it("parses the required fields and applies defaults", async () => {
    const env = await loadServerEnv();
    expect(env.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.ADMIN_SEED_EMAIL).toBeUndefined();
  });

  // `set -a; source .env` exports a blank line (ADMIN_SEED_EMAIL=) as an empty
  // string, and Zod counts "" as a provided value that fails .email(). Every
  // optional-but-blank var in .env.example went through this path.
  it("treats a blank optional value as unset rather than an invalid one", async () => {
    setEnv({
      ...REQUIRED,
      ADMIN_SEED_EMAIL: "",
      SETUP_TOKEN: "",
      LANGFUSE_HOST: "",
      SMTP_TRANSPORT_MODE: "",
      SMTP_PORT: "",
      N8N_WEBHOOK_SECRET: "",
      PKI_TRUSTED_PROXY_IPS: "",
    });
    const env = await loadServerEnv();
    expect(env.ADMIN_SEED_EMAIL).toBeUndefined();
    expect(env.SETUP_TOKEN).toBeUndefined();
    expect(env.LANGFUSE_HOST).toBeUndefined();
    expect(env.SMTP_TRANSPORT_MODE).toBeUndefined();
    expect(env.SMTP_PORT).toBeUndefined();
  });

  it("keeps the boolean and string defaults a blank value used to produce", async () => {
    setEnv({ ...REQUIRED, MINIO_REGION: "", MINIO_PATH_STYLE: "" });
    const env = await loadServerEnv();
    expect(env.MINIO_REGION).toBe("");
    expect(env.MINIO_PATH_STYLE).toBe(true);
  });

  it("still rejects a non-empty value that is genuinely invalid", async () => {
    setEnv({ ...REQUIRED, ADMIN_SEED_EMAIL: "not-an-email" });
    await expect(loadServerEnv()).rejects.toThrow(/ADMIN_SEED_EMAIL|Invalid email/);
  });

  // The documented quick start is `cp .env.example .env` (restart.sh does it for
  // you) followed by `source .env`. That must produce a bootable app.
  it("accepts .env.example exactly as restart.sh exports it", async () => {
    const examplePath = fileURLToPath(new URL("../../../../.env.example", import.meta.url));
    const shellExported: Record<string, string> = {};
    for (const line of readFileSync(examplePath, "utf8").split("\n")) {
      const assignment = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      const [, name, value] = assignment ?? [];
      if (name === undefined || value === undefined) continue;
      shellExported[name] = value;
    }
    setEnv({ ...shellExported, ...REQUIRED });
    await expect(loadServerEnv()).resolves.toBeDefined();
  });
});
