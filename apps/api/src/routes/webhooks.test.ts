import { createHmac } from "crypto";
import type { AddressInfo } from "net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Container } from "../container.js";
import { buildWebhooksRouter } from "./webhooks.js";

const SECRET = "shared-secret";

const sign = (body: string): string =>
  "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");

const makeContainer = (applyAutoNodeResult: { execute: ReturnType<typeof vi.fn> }): Container =>
  ({
    env: { N8N_WEBHOOK_SECRET: SECRET },
    useCases: { applyAutoNodeResult },
  }) as unknown as Container;

const startServer = (container: Container) => {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use("/v1/webhooks", buildWebhooksRouter(container));
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/v1/webhooks/n8n/sess-1` };
};

let server: ReturnType<typeof startServer>["server"] | null = null;

const post = async (url: string, body: unknown, signature: string | null) => {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature) headers["X-N8n-Signature"] = signature;
  return fetch(url, { method: "POST", headers, body: raw });
};

afterEach(() => {
  server?.close();
  server = null;
});

describe("POST /v1/webhooks/n8n/:sessionId", () => {
  let applyAutoNodeResult: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    applyAutoNodeResult = { execute: vi.fn().mockResolvedValue({ data: { applied: true, advanced: true } }) };
  });

  it("applies a valid, signed callback and advances", async () => {
    const started = startServer(makeContainer(applyAutoNodeResult));
    server = started.server;

    const body = { correlationId: "corr-1", nodeId: "node-1", status: "completed", data: { vendor: "Acme" } };
    const response = await post(started.url, body, sign(JSON.stringify(body)));

    expect(response.status).toBe(200);
    expect(applyAutoNodeResult.execute).toHaveBeenCalledWith({
      sessionId: "sess-1",
      correlationId: "corr-1",
      nodeId: "node-1",
      status: "completed",
      data: { vendor: "Acme" },
      message: undefined,
    });
  });

  it("rejects an invalid signature with 401 and never calls the use case", async () => {
    const started = startServer(makeContainer(applyAutoNodeResult));
    server = started.server;

    const body = { nodeId: "node-1", status: "completed", data: {} };
    const response = await post(started.url, body, "sha256=deadbeef");

    expect(response.status).toBe(401);
    expect(applyAutoNodeResult.execute).not.toHaveBeenCalled();
  });

  it("rejects a missing signature header with 401", async () => {
    const started = startServer(makeContainer(applyAutoNodeResult));
    server = started.server;

    const body = { nodeId: "node-1", status: "completed", data: {} };
    const response = await post(started.url, body, null);

    expect(response.status).toBe(401);
  });

  it("returns 400 on a malformed body (missing nodeId)", async () => {
    const started = startServer(makeContainer(applyAutoNodeResult));
    server = started.server;

    const body = { status: "completed", data: {} };
    const response = await post(started.url, body, sign(JSON.stringify(body)));

    expect(response.status).toBe(400);
    expect(applyAutoNodeResult.execute).not.toHaveBeenCalled();
  });

  it("acknowledges a stale/duplicate callback with 200 and an ignored flag", async () => {
    applyAutoNodeResult.execute.mockResolvedValue({ data: { applied: false, advanced: false } });
    const started = startServer(makeContainer(applyAutoNodeResult));
    server = started.server;

    const body = { correlationId: "stale", nodeId: "node-1", status: "completed", data: {} };
    const response = await post(started.url, body, sign(JSON.stringify(body)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ignored: true } });
  });
});
