import { beforeEach, describe, expect, it, vi } from "vitest";

// The index's own server-side gate (redline delivery-plan item 2). The router's
// gate is proven in server/routers/evaluation.test.ts; this proves the other
// half of the item's exit — that a user without evaluation:review does not get
// the route at all, rather than an empty screen. Next's real notFound() throws,
// so the mock throws too.
const { notFound, createServerTrpcContext } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  createServerTrpcContext: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/server-context", () => ({ createServerTrpcContext }));
vi.mock("./_content", () => ({ EvaluationsIndexContent: () => null }));

const { default: EvaluationsIndexPage } = await import("./page");

beforeEach(() => {
  notFound.mockClear();
  createServerTrpcContext.mockReset();
});

describe("EvaluationsIndexPage — the evaluation:review gate", () => {
  it("serves the index to a caller holding evaluation:review", async () => {
    createServerTrpcContext.mockResolvedValue({
      isAdmin: false,
      permissions: new Set(["evaluation:review"]),
    });

    await expect(EvaluationsIndexPage()).resolves.toBeDefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("serves the index to an admin, who passes on the wildcard", async () => {
    createServerTrpcContext.mockResolvedValue({ isAdmin: true, permissions: new Set() });

    await expect(EvaluationsIndexPage()).resolves.toBeDefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("404s a caller without the permission rather than rendering an empty index", async () => {
    createServerTrpcContext.mockResolvedValue({ isAdmin: false, permissions: new Set() });

    await expect(EvaluationsIndexPage()).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalled();
  });

  it("404s an unauthenticated caller, who resolves to no permissions at all", async () => {
    createServerTrpcContext.mockResolvedValue({
      isAdmin: false,
      permissions: new Set(),
      userId: null,
    });

    await expect(EvaluationsIndexPage()).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalled();
  });
});
