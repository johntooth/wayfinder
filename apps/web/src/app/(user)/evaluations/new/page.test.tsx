import { beforeEach, describe, expect, it, vi } from "vitest";

// The create route's own server-side gate. Creating an evaluation is a write, so
// it is gated on evaluation:create rather than the review key — holding the
// review permission opens the grid, it does not start a tender. The procedure's
// gate is proven in server/routers/evaluation.test.ts; this proves a caller who
// cannot create never gets the form. Next's real notFound() throws, so the mock
// throws too.
const { notFound, createServerTrpcContext } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  createServerTrpcContext: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/server-context", () => ({ createServerTrpcContext }));
vi.mock("./_content", () => ({ CreateEvaluationContent: () => null }));

const { default: CreateEvaluationPage } = await import("./page");

beforeEach(() => {
  notFound.mockClear();
  createServerTrpcContext.mockReset();
});

describe("CreateEvaluationPage — the evaluation:create gate", () => {
  it("serves the form to a caller holding evaluation:create", async () => {
    createServerTrpcContext.mockResolvedValue({
      isAdmin: false,
      permissions: new Set(["evaluation:create"]),
    });

    await expect(CreateEvaluationPage()).resolves.toBeDefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("serves the form to an admin, who passes on the wildcard", async () => {
    createServerTrpcContext.mockResolvedValue({ isAdmin: true, permissions: new Set() });

    await expect(CreateEvaluationPage()).resolves.toBeDefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("404s a reviewer, who may open an evaluation but not start one", async () => {
    createServerTrpcContext.mockResolvedValue({
      isAdmin: false,
      permissions: new Set(["evaluation:review"]),
    });

    await expect(CreateEvaluationPage()).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalled();
  });

  it("404s a caller with no permissions at all", async () => {
    createServerTrpcContext.mockResolvedValue({ isAdmin: false, permissions: new Set() });

    await expect(CreateEvaluationPage()).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalled();
  });
});
