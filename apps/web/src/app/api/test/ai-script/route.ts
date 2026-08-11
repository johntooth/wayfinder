import { NextResponse } from "next/server";
import { getScriptedLanguageModel } from "@/lib/scripted-llm";

// This endpoint only exists when TEST_AUTH_BYPASS=true. It registers canned AI
// responses for a session so E2E specs can drive the server-side model — the
// browser-level route intercept in apps/web/e2e/helpers/base.ts cannot reach
// the provider calls the Next.js server makes.
//
// POST { sessionId, responses: [{ purpose?, object?, text?, failWith? }] }
// DELETE ?sessionId=… (or no query, to clear every script)

interface ScriptRequest {
  readonly sessionId?: unknown;
  readonly responses?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const scripted = getScriptedLanguageModel();
  if (!scripted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as ScriptRequest | null;
  if (typeof body?.sessionId !== "string" || !body.sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!Array.isArray(body.responses) || body.responses.length === 0) {
    return NextResponse.json({ error: "responses must be a non-empty array" }, { status: 400 });
  }

  scripted.script(body.sessionId, body.responses);
  return NextResponse.json({ sessionId: body.sessionId, scripted: body.responses.length });
}

export async function DELETE(request: Request): Promise<Response> {
  const scripted = getScriptedLanguageModel();
  if (!scripted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  scripted.clear(sessionId ?? undefined);
  return NextResponse.json({ cleared: sessionId ?? "all" });
}
