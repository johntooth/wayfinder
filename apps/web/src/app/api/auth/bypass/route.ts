import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getContainer } from "@/lib/container";
import { schema } from "@rbrasier/adapters";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Only internal, single-leading-slash paths are accepted so the redirect target
// can never be used as an open redirect to an external origin.
const sanitiseRedirect = (value: string | null): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/chats";
  return value;
};

// Experimentation-only login bypass: mints a seed-admin session and sets the
// session cookie so every downstream auth guard passes unchanged. Hard-refused
// in production regardless of the flag.
export async function GET(req: Request): Promise<Response> {
  if (process.env.AUTH_BYPASS !== "true" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { env, db, repos } = getContainer();

  if (!env.ADMIN_SEED_EMAIL) {
    return NextResponse.json(
      { error: "ADMIN_SEED_EMAIL must be set to use AUTH_BYPASS." },
      { status: 500 },
    );
  }

  const userResult = await repos.users.findByEmail(env.ADMIN_SEED_EMAIL);
  if ("error" in userResult) {
    return NextResponse.json({ error: "Database error looking up user." }, { status: 500 });
  }

  let user = userResult.data;
  if (!user) {
    const createResult = await repos.users.create({ email: env.ADMIN_SEED_EMAIL, isAdmin: true });
    if ("error" in createResult) {
      return NextResponse.json({ error: "Failed to create admin user." }, { status: 500 });
    }
    user = createResult.data;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  try {
    await db.insert(schema.core_sessions).values({
      user_id: user.id,
      token,
      expires_at: expiresAt,
    });
  } catch {
    return NextResponse.json({ error: "Failed to create session." }, { status: 500 });
  }

  const target = sanitiseRedirect(new URL(req.url).searchParams.get("redirect"));
  // A relative Location keeps the redirect on whatever host the browser used.
  // The absolute form (new URL(target, req.url)) would leak the server's internal
  // host:port when the app runs behind a port map or proxy, 307-ing to the wrong
  // origin. sanitiseRedirect already guarantees a single-leading-slash path.
  const response = new NextResponse(null, { status: 307, headers: { Location: target } });
  response.cookies.set("better-auth.session_token", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
  return response;
}
