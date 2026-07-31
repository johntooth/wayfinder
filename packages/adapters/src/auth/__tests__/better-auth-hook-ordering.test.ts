import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

/**
 * Pins the Better Auth behaviour the Entra precedence rule depends on.
 *
 * `applyEntraPrecedence` revokes the linked user's sessions. That is only
 * correct if it runs before Better Auth issues the session for the sign-in that
 * triggered the link — otherwise it deletes that session too and the user is
 * bounced back to /login.
 *
 * Better Auth runs each request inside `runWithAdapter`, which collects
 * `create.after` hooks and flushes them when the request ends, while
 * `create.before` hooks are awaited inline. The library's own doc comment says
 * an after-hook "will execute immediately" outside a transaction, which is only
 * true when no async-storage store exists at all — during an endpoint one
 * always does. This test exists because that comment is misleading, and because
 * the ordering is third-party behaviour that an upgrade could change silently.
 */
describe("Better Auth account-hook ordering", () => {
  it("runs create.before inline and defers create.after past session creation", async () => {
    const events: string[] = [];
    const store: Record<string, unknown[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };

    const auth = betterAuth({
      database: memoryAdapter(store),
      secret: "test-secret-value-at-least-32-chars-long",
      baseURL: "http://localhost:3000",
      emailAndPassword: { enabled: true, autoSignIn: true },
      databaseHooks: {
        account: {
          create: {
            before: async () => {
              events.push("account.before");
            },
            after: async () => {
              events.push("account.after");
            },
          },
        },
        session: {
          create: {
            before: async () => {
              events.push("session.create");
            },
          },
        },
      },
    });

    await auth.api.signUpEmail({
      body: { email: "order@example.com", password: "Password!2345", name: "Order Probe" },
    });

    expect(events).toEqual(["account.before", "session.create", "account.after"]);
  });
});
