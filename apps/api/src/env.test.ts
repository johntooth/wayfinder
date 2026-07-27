import { describe, it, expect } from "vitest";
import { loadEnv } from "./env.js";

const REQUIRED = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/testdb",
  SETTINGS_ENCRYPTION_KEY: "0".repeat(64),
};

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

describe("loadEnv", () => {
  it("parses required fields and applies defaults", () => {
    withEnv({ ...REQUIRED, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, LANGFUSE_HOST: undefined }, () => {
      const env = loadEnv();
      expect(env.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
      expect(["development", "test"]).toContain(env.NODE_ENV);
    });
  });

  it("does not throw when OTEL_EXPORTER_OTLP_ENDPOINT is an empty string", () => {
    withEnv({ ...REQUIRED, OTEL_EXPORTER_OTLP_ENDPOINT: "" }, () => {
      expect(() => loadEnv()).not.toThrow();
      expect(loadEnv().OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    });
  });

  it("does not throw when LANGFUSE_HOST is an empty string", () => {
    withEnv({ ...REQUIRED, LANGFUSE_HOST: "" }, () => {
      expect(() => loadEnv()).not.toThrow();
      expect(loadEnv().LANGFUSE_HOST).toBeUndefined();
    });
  });

  it("accepts a valid URL for OTEL_EXPORTER_OTLP_ENDPOINT", () => {
    withEnv({ ...REQUIRED, OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" }, () => {
      expect(loadEnv().OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://localhost:4318");
    });
  });

  it("throws when OTEL_EXPORTER_OTLP_ENDPOINT is a non-URL string", () => {
    withEnv({ ...REQUIRED, OTEL_EXPORTER_OTLP_ENDPOINT: "not-a-url" }, () => {
      expect(() => loadEnv()).toThrow();
    });
  });

  it("requires SETTINGS_ENCRYPTION_KEY", () => {
    withEnv({ ...REQUIRED, SETTINGS_ENCRYPTION_KEY: undefined }, () => {
      expect(() => loadEnv()).toThrow();
    });
  });

  it("rejects a SETTINGS_ENCRYPTION_KEY that is not a 32-byte key", () => {
    withEnv({ ...REQUIRED, SETTINGS_ENCRYPTION_KEY: "too-short" }, () => {
      expect(() => loadEnv()).toThrow();
    });
  });

  it("accepts a base64-encoded 32-byte SETTINGS_ENCRYPTION_KEY", () => {
    withEnv({ ...REQUIRED, SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") }, () => {
      expect(() => loadEnv()).not.toThrow();
    });
  });

  // The tick URL is derivable from the web app's base URL; the shared secret is
  // not. Only the secret should stand between a default install and a running
  // scheduler.
  it("derives SCHEDULER_TICK_URL from WEB_BASE_URL when it is not set", () => {
    withEnv({ ...REQUIRED, SCHEDULER_TICK_URL: undefined, WEB_BASE_URL: undefined }, () => {
      expect(loadEnv().SCHEDULER_TICK_URL).toBe("http://localhost:3000/api/internal/scheduler/tick");
    });
  });

  it("derives the tick URL from a custom WEB_BASE_URL without doubling the slash", () => {
    withEnv({ ...REQUIRED, SCHEDULER_TICK_URL: undefined, WEB_BASE_URL: "https://app.example.com/" }, () => {
      expect(loadEnv().SCHEDULER_TICK_URL).toBe(
        "https://app.example.com/api/internal/scheduler/tick",
      );
    });
  });

  it("keeps an explicit SCHEDULER_TICK_URL for split deployments", () => {
    withEnv({ ...REQUIRED, SCHEDULER_TICK_URL: "http://web.internal:3000/tick" }, () => {
      expect(loadEnv().SCHEDULER_TICK_URL).toBe("http://web.internal:3000/tick");
    });
  });

  // The extraction worker resolves documents through these; hardcoding them left
  // an env-only deployment pointed at a MinIO that is not there.
  it("reads the object storage fallback from MINIO_* like the web app does", () => {
    withEnv(
      {
        ...REQUIRED,
        MINIO_ENDPOINT: "s3.eu-west-2.amazonaws.com",
        MINIO_USE_SSL: "true",
        MINIO_REGION: "eu-west-2",
        MINIO_PATH_STYLE: "false",
      },
      () => {
        const env = loadEnv();
        expect(env.MINIO_ENDPOINT).toBe("s3.eu-west-2.amazonaws.com");
        expect(env.MINIO_USE_SSL).toBe(true);
        expect(env.MINIO_REGION).toBe("eu-west-2");
        expect(env.MINIO_PATH_STYLE).toBe(false);
      },
    );
  });

  it("falls back to the local MinIO defaults when no MINIO_* vars are set", () => {
    withEnv(
      {
        ...REQUIRED,
        MINIO_ENDPOINT: undefined,
        MINIO_PORT: undefined,
        MINIO_USE_SSL: undefined,
        MINIO_PATH_STYLE: undefined,
      },
      () => {
        const env = loadEnv();
        expect(env.MINIO_ENDPOINT).toBe("localhost");
        expect(env.MINIO_PORT).toBe(9000);
        expect(env.MINIO_USE_SSL).toBe(false);
        expect(env.MINIO_PATH_STYLE).toBe(true);
      },
    );
  });
});
