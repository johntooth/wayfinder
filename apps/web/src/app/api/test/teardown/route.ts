import { NextResponse } from "next/server";
import { getContainer } from "@/lib/container";
import { teardownE2EFixtures } from "@/lib/e2e-fixtures";

// This endpoint only exists when TEST_AUTH_BYPASS=true. It clears all seeded and
// test-created flow/session data from the E2E database after the suite runs.
export async function POST(): Promise<Response> {
  if (process.env.TEST_AUTH_BYPASS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await teardownE2EFixtures(getContainer());
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown teardown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
