import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { approvalRouter } from "./approval";

const createCaller = createCallerFactory(router({ approval: approvalRouter }));

const makeContainer = (): Container =>
  ({
    services: { errorLogger: { log: async () => undefined } },
    repos: { users: { findById: vi.fn().mockResolvedValue(ok({ email: "a@b.c" })) } },
    useCases: {
      decideApproval: {
        execute: vi
          .fn()
          .mockResolvedValue(ok({ advanced: true, newNodeId: null, sessionCompleted: false })),
      },
    },
  }) as unknown as Container;

const contextWith = (container: Container): TrpcContext => ({
  container,
  userId: "user-1",
  isAdmin: false,
  permissions: new Set(),
  headers: new Headers(),
});

const approvalId = "11111111-1111-1111-1111-111111111111";

describe("approval.decide", () => {
  // `approved_with_edits` is derived by the system, never chosen. If it ever
  // becomes selectable the control is worthless — an approver could claim it
  // without editing, or withhold it after editing (ADR-045 §4).
  it("accepts exactly the three decisions an approver can choose", async () => {
    const container = makeContainer();
    const caller = createCaller(contextWith(container));

    for (const decision of ["approved", "rejected", "changes_requested"] as const) {
      await expect(caller.approval.decide({ approvalId, decision })).resolves.toBeTruthy();
    }
  });

  it("refuses approved_with_edits as an approver-selectable decision", async () => {
    const caller = createCaller(contextWith(makeContainer()));

    await expect(
      caller.approval.decide({
        approvalId,
        decision: "approved_with_edits" as never,
      }),
    ).rejects.toThrow();
  });
});
