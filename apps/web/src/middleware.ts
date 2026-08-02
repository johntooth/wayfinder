import { NextResponse, type NextRequest } from "next/server";

const getSessionCookie = (req: NextRequest) =>
  req.cookies
    .getAll()
    .find((c) => c.name.endsWith(".session_token") || c.name === "better-auth.session_token");

// Sign-in destinations are not somewhere to send a visitor back to, so they
// carry no redirect: bouncing /admin/login to /login?redirect=/admin/login
// would just point at another login page.
const AUTH_PATHS = new Set(["/login", "/admin/login", "/register", "/admin/register"]);

// Always /login, in every configuration. Middleware runs in the Edge runtime and
// cannot read the database, so it cannot know which methods are enabled; the
// login page can, and renders the right controls (ADR-042 §2). The requested
// path rides along so a certificate sign-in still lands where the user was
// headed — the deep link survives the extra click.
const redirectToLogin = (req: NextRequest, pathname: string): NextResponse => {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  if (!AUTH_PATHS.has(pathname)) {
    url.searchParams.set("redirect", pathname);
  }
  return NextResponse.redirect(url);
};

export const middleware = (req: NextRequest): NextResponse => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") || pathname.startsWith("/chats") || pathname.startsWith("/flows")) {
    const sessionCookie = getSessionCookie(req);
    if (!sessionCookie?.value) {
      return redirectToLogin(req, pathname);
    }
  }

  return NextResponse.next();
};

export const config = {
  matcher: ["/login", "/register", "/admin/:path*", "/chats/:path*", "/chats", "/flows/:path*"],
};
