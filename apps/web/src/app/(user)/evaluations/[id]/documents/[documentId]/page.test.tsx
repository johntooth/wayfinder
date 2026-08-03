import { beforeEach, describe, expect, it, vi } from "vitest";

// The document route's own server-side gate (redline delivery-plan item 1). The
// router's gate is proven in server/routers/evaluation.test.ts; this proves the
// route itself is invisible without evaluation:review, rather than a shell that
// renders and then fails to load. Next's real notFound() throws, so the mock
// throws too.
const { notFound, createServerTrpcContext } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  createServerTrpcContext: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/server-context", () => ({ createServerTrpcContext }));
vi.mock("./_content", () => ({ EvaluationDocumentContent: () => null }));

const { default: EvaluationDocumentPage } = await import("./page");

const params = Promise.resolve({ id: "eval-1", documentId: "doc-1" });

beforeEach(() => {
  notFound.mockClear();
  createServerTrpcContext.mockReset();
});

describe("EvaluationDocumentPage — the evaluation:review gate", () => {
  it("serves the document to a caller holding evaluation:review", async () => {
    createServerTrpcContext.mockResolvedValue({
      isAdmin: false,
      permissions: new Set(["evaluation:review"]),
    });

    await expect(EvaluationDocumentPage({ params })).resolves.toBeDefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("serves the document to an admin, who passes on the wildcard", async () => {
    createServerTrpcContext.mockResolvedValue({ isAdmin: true, permissions: new Set() });

    await expect(EvaluationDocumentPage({ params })).resolves.toBeDefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("404s a caller without the permission rather than rendering the document", async () => {
    createServerTrpcContext.mockResolvedValue({ isAdmin: false, permissions: new Set() });

    await expect(EvaluationDocumentPage({ params })).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalled();
  });

  // The gate runs before the route params are read, so a caller without the
  // permission cannot use the route to probe which document ids exist.
  it("404s before touching the requested document id", async () => {
    createServerTrpcContext.mockResolvedValue({ isAdmin: false, permissions: new Set() });
    const unread = { then: vi.fn() } as unknown as typeof params;

    await expect(EvaluationDocumentPage({ params: unread })).rejects.toThrow(/404/);
    expect(unread.then).not.toHaveBeenCalled();
  });
});
