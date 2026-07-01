import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// The container is only reached once the env guards pass, so the disabled-path
// tests never touch a DB. Mock it so an accidental call fails loudly instead of
// connecting to Postgres.
vi.mock("@/lib/container", () => ({
  getContainer: () => {
    throw new Error("getContainer must not be called when AUTH_BYPASS is disabled");
  },
}));

const buildRequest = (): Request =>
  new Request("http://localhost:3000/api/auth/bypass?redirect=/chats");

describe("/api/auth/bypass — env guards", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 when AUTH_BYPASS is not set", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await GET(buildRequest());

    expect(response.status).toBe(404);
  });

  it("returns 404 under production even when the flag is set", async () => {
    vi.stubEnv("AUTH_BYPASS", "true");
    vi.stubEnv("NODE_ENV", "production");

    const response = await GET(buildRequest());

    expect(response.status).toBe(404);
  });
});
