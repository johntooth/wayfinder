/**
 * fix-zero-env-first-run.spec.ts
 *
 * Regression guard for the zero-env first run (fix: zero-env-first-run).
 *
 * Root cause (fixed in this patch):
 *   The documented quick start is `cp .env.example .env` — restart.sh does it
 *   for you — followed by `set -a; source .env`. Shell export turns a
 *   blank-value line (`ADMIN_SEED_EMAIL=`) into an empty string, and Zod counts
 *   "" as a provided value rather than an absent one, so `.email()` / `.url()`
 *   rejected it. `serverEnv()` therefore threw on every call, and because it is
 *   built lazily per request the app still compiled and served its client-side
 *   login and /setup shells while every tRPC procedure and every Better Auth
 *   route answered 500. apps/api already stripped blanks in loadEnv(); apps/web
 *   now does the same.
 *
 * What is tested:
 *   The stack this suite runs against is booted with blank-but-present optional
 *   vars (LANGFUSE_HOST, SETUP_TOKEN, N8N_WEBHOOK_SECRET — see the `env:` block
 *   in .github/workflows/e2e.yml), which is exactly what sourcing .env.example
 *   produces. Every surface below resolves the server env, so on the unfixed
 *   code each one answers 500 with a ZodError body.
 *
 *   Note that on unfixed code this failure is not confined to this spec — a
 *   stack booted that way serves nothing, so the whole suite goes red. That is
 *   the point: the blank-optional path is now exercised on every run rather
 *   than only when someone follows the README by hand.
 */

import { test, expect } from "./helpers/base";

test.describe("fix: blank optional env vars do not break the app", () => {
  // The public first-run surface. It is the first thing a new install touches,
  // and it is unauthenticated, so it fails independently of the auth fixture.
  test("the public bootstrap query answers without a server env error", async ({ page }) => {
    const response = await page.request.get(
      "/api/trpc/bootstrap.adminExists?input=" + encodeURIComponent("{}"),
    );

    expect(response.status()).not.toBe(500);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).not.toHaveProperty("error");
    // Shape assertion rather than a value one: whether an admin exists depends
    // on the seed, but a resolved env is what lets the procedure answer at all.
    expect(body.result.data.json).toHaveProperty("adminExists");
  });

  // The reported symptom: the login page rendered fine (it is a client
  // component) and then sign-in returned 500.
  test("an authenticated procedure answers rather than 500ing", async ({ page }) => {
    const response = await page.request.get(
      "/api/trpc/settings.getSetupStatus?input=" + encodeURIComponent("{}"),
    );

    expect(response.status()).not.toBe(500);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).not.toHaveProperty("error");
    // getSetupStatus reads SETTINGS_ENCRYPTION_KEY straight off the parsed env,
    // so a truthy value here proves the parse produced a usable object and not
    // just an absence of throwing.
    expect(body.result.data.json.encryptionKeyReady).toBe(true);
  });

  // A blank LANGFUSE_HOST used to fail .url() and take the app down with it.
  // Stripped to unset, tracing stays stubbed and the AI-backed surfaces work.
  test("a blank observability endpoint leaves the app serving", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page.getByTestId("rerun-setup")).toBeVisible();
  });
});
