import { NextResponse } from "next/server";
import { getContainer } from "@/lib/container";
import { seedE2EFixtures } from "@/lib/e2e-fixtures";

// This endpoint only exists when TEST_AUTH_BYPASS=true. It seeds deterministic
// fixtures (a published flow with a session, conversation history, a generated
// document, and extra flows) so the E2E suite can exercise specs that otherwise
// skip for lack of data.
export async function POST(): Promise<Response> {
  if (process.env.TEST_AUTH_BYPASS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await seedE2EFixtures(getContainer());
    return NextResponse.json(result);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown seeding error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
