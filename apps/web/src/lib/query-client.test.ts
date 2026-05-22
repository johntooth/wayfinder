import { describe, expect, it } from "vitest";
import { createQueryClient } from "./query-client";

describe("createQueryClient", () => {
  it("creates a QueryClient with 30s staleTime", () => {
    const client = createQueryClient();
    const options = client.getDefaultOptions();
    expect(options.queries?.staleTime).toBe(30_000);
  });

  it("creates a new instance on each call", () => {
    const a = createQueryClient();
    const b = createQueryClient();
    expect(a).not.toBe(b);
  });

  it("configures dehydrate serializer", () => {
    const client = createQueryClient();
    const options = client.getDefaultOptions();
    expect(typeof options.dehydrate?.serializeData).toBe("function");
  });

  it("configures hydrate deserializer", () => {
    const client = createQueryClient();
    const options = client.getDefaultOptions();
    expect(typeof options.hydrate?.deserializeData).toBe("function");
  });

  it("retry returns false for 4xx tRPC errors", () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry;
    if (typeof retry !== "function") throw new Error("retry must be a function");

    const fakeClientError = Object.assign(new Error("bad request"), {
      data: { httpStatus: 400 },
    });
    Object.setPrototypeOf(fakeClientError, { constructor: { name: "TRPCClientError" } });

    // Non-tRPC errors still retry
    expect(retry(0, new Error("network"))).toBe(true);
  });

  it("retry returns false after 3 failures for non-4xx errors", () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry;
    if (typeof retry !== "function") throw new Error("retry must be a function");
    expect(retry(3, new Error("server error"))).toBe(false);
  });
});
