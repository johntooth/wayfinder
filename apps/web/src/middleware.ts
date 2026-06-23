import { NextResponse, type NextRequest } from "next/server";

const AUTH_METHOD = process.env.AUTH_METHOD ?? "email-password";
const PKI_MODES = new Set(["pki", "pki-and-email-password"]);

const getSessionCookie = (req: NextRequest) =>
  req.cookies
    .getAll()
    .find((c) => c.name.endsWith(".session_token") || c.name === "better-auth.session_token");

const AUTH_PAGES = new Set(["/login", "/register"]);

// Experimentation switch (env-gated, never in production): when on, the login
// screen is replaced by an auto-minted seed-admin session. Read at call time so
// the value is honoured per request rather than frozen at module load.
const isAuthBypassEnabled = (): boolean =>
  process.env.AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production";

const redirectToBypass = (req: NextRequest, pathname: string): NextResponse => {
  const url = req.nextUrl.clone();
  url.pathname = "/api/auth/bypass";
  url.search = "";
  url.searchParams.set("redirect", AUTH_PAGES.has(pathname) ? "/chats" : pathname);
  return NextResponse.redirect(url);
};

const redirectToChats = (req: NextRequest): NextResponse => {
  const url = req.nextUrl.clone();
  url.pathname = "/chats";
  url.search = "";
  return NextResponse.redirect(url);
};

const redirectToLogin = (req: NextRequest, pathname: string): NextResponse => {
  const url = req.nextUrl.clone();
  if (PKI_MODES.has(AUTH_METHOD)) {
    url.pathname = "/api/auth/cert";
    url.searchParams.set("redirect", pathname);
  } else {
    url.pathname = "/login";
  }
  return NextResponse.redirect(url);
};

export const middleware = (req: NextRequest): NextResponse => {
  const { pathname } = req.nextUrl;

  if (isAuthBypassEnabled()) {
    const sessionCookie = getSessionCookie(req);
    if (!sessionCookie?.value) {
      return redirectToBypass(req, pathname);
    }
    if (AUTH_PAGES.has(pathname)) {
      return redirectToChats(req);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/chats") || pathname.startsWith("/flows")) {
    const sessionCookie = getSessionCookie(req);
    if (!sessionCookie?.value) {
      return redirectToLogin(req, pathname);
    }
  }

  return NextResponse.next();
};

// /approvals, /knowledge, /sample and /settings self-protect in their server
// layout, so the normal-auth branch above leaves them alone — but they must be
// matched so AUTH_BYPASS can mint a session on a direct deep link to any of them
// instead of bouncing through /login.
export const config = {
  matcher: [
    "/",
    "/login",
    "/register",
    "/admin/:path*",
    "/approvals",
    "/approvals/:path*",
    "/chats",
    "/chats/:path*",
    "/flows",
    "/flows/:path*",
    "/knowledge",
    "/knowledge/:path*",
    "/sample",
    "/sample/:path*",
    "/settings",
    "/settings/:path*",
  ],
};
