import type { Page } from "@playwright/test";
import { CHAT_STREAM_ROUTE } from "./base";

/**
 * Drives the server-side AI stub (`/api/test/ai-script`).
 *
 * The AI mock in `helpers/base.ts` is a `page.route` intercept, so it only sees
 * requests the *browser* makes. Every turn, branch choice and document-gate
 * judgement is made by the Next.js server, out of its reach — which is why the
 * specs asserting on those were parked behind env vars CI never sets. This
 * registers canned responses the server will return for a given session.
 *
 * Scripts are consumed in order, and the last one repeats, so scripting the
 * turns a spec cares about is enough; incidental calls do not fall back to a
 * default that contradicts them.
 */

export interface ScriptedResponse {
  /** Matches only calls made for this purpose ("chat", "branching", …). */
  purpose?: string;
  /** Fields to return. Merged over a schema-shaped default, so partial is fine. */
  object?: Record<string, unknown>;
  /** For text calls such as "chat-title". */
  text?: string;
  /** Fail the call instead of answering, to exercise the error paths. */
  failWith?: string;
}

// Paths are passed to page.request as-is: the APIRequestContext resolves them
// against the context's baseURL. Resolving them here against page.url() instead
// looked equivalent and was not — a script registered before the first
// navigation saw `about:blank`, and `new URL('/api/…', 'about:blank')` throws.
// Scripting before navigating is the normal order, so that broke every caller.

export async function scriptAiFor(
  page: Page,
  sessionId: string,
  responses: ScriptedResponse[],
): Promise<void> {
  // The base fixture answers /api/chat/<id>/stream in the browser, so without
  // this the request never reaches the server and the script is never read.
  // Lifting it here rather than in each spec means using the script and taking
  // the server path cannot come apart.
  await page.unroute(CHAT_STREAM_ROUTE);

  const response = await page.request.post("/api/test/ai-script", {
    data: { sessionId, responses },
  });
  if (response.ok()) return;
  throw new Error(
    `Could not script the server-side AI for ${sessionId}: ${response.status()} ${await response.text()}. ` +
      `The route only exists when TEST_AUTH_BYPASS=true and USE_REAL_AI is not "true".`,
  );
}

export async function clearAiScript(page: Page, sessionId?: string): Promise<void> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  await page.request.delete(`/api/test/ai-script${query}`);
}

/** A turn that leaves the step short of its completion threshold. */
export const incompleteTurn = (response: string, confidence = 20): ScriptedResponse => ({
  purpose: "chat",
  object: { response, rationale: "Still gathering information.", stepCompleteConfidence: confidence },
});

/** A turn that reports the step's completion criteria as met. */
export const completeTurn = (response: string, confidence = 95): ScriptedResponse => ({
  purpose: "chat",
  object: { response, rationale: "Completion criteria are met.", stepCompleteConfidence: confidence },
});
