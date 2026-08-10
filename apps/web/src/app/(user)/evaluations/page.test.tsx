import { beforeEach, describe, expect, it, vi } from "vitest";

// The index's own server-side gate (redline delivery-plan item 2). The router's
// gate is proven in server/routers/evaluation.test.ts; this proves the other
// half of the item's exit — that a user without evaluation:review does not get
// the route at all, rather than an empty screen. Next's real notFound() throws,
// so the mock throws too.
const { notFound, createServerTrpcContext, indexContent } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  createServerTrpcContext: vi.fn(),
  indexContent: vi.fn(() => null),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/server-context", () => ({ createServerTrpcContext }));
vi.mock("./_content", () => ({ EvaluationsIndexContent: indexContent }));

const { default: EvaluationsIndexPage } = await import("./page");

beforeEach(() => {
  notFound.mockClear();
  createServerTrpcContext.mockReset();
  indexContent.mockClear();
});

// The index resolves canCreate server-side from the caller's own permissions,
// so the "New evaluation" link is offered only to someone the create route
// would actually admit. Rendering a link that 404s would be worse than not
// rendering one.
const renderedCanCreate = async () => {
  const element = (await EvaluationsIndexPage()) as { props: { canCreate: boolean } };
  return element.props.canCreate;
};

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

  it("offers the create link to a reviewer who also holds evaluation:create", async () => {
    createServerTrpcContext.mockResolvedValue({
      isAdmin: false,
      permissions: new Set(["evaluation:review", "evaluation:create"]),
    });

    expect(await renderedCanCreate()).toBe(true);
  });

  it("withholds the create link from a reviewer who does not hold it", async () => {
    createServerTrpcContext.mockResolvedValue({
      isAdmin: false,
      permissions: new Set(["evaluation:review"]),
    });

    expect(await renderedCanCreate()).toBe(false);
  });

  it("offers the create link to an admin on the wildcard", async () => {
    createServerTrpcContext.mockResolvedValue({ isAdmin: true, permissions: new Set() });

    expect(await renderedCanCreate()).toBe(true);
  });

  // The (user) layout redirects a caller with no session to /login before this
  // page runs, so the 404 is the gate's own backstop rather than the path an
  // unauthenticated visitor actually takes.
  it("404s a caller whose session resolved to no permissions at all", async () => {
    createServerTrpcContext.mockResolvedValue({
      isAdmin: false,
      permissions: new Set(),
      userId: null,
    });

    await expect(EvaluationsIndexPage()).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalled();
  });
});
