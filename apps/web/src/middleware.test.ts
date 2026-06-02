import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const buildRequest = (pathname: string, sessionToken?: string): NextRequest => {
  const headers = new Headers();
  if (sessionToken) {
    headers.set("cookie", `better-auth.session_token=${sessionToken}`);
  }
  return new NextRequest(new URL(`http://localhost:3000${pathname}`), { headers });
};

describe("middleware — /register redirect for logged-in users", () => {
  it("redirects a request with a session cookie to /admin", () => {
    const response = middleware(buildRequest("/register", "session-token-value"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/admin");
  });

  it("lets an unauthenticated visitor reach /register", () => {
    const response = middleware(buildRequest("/register"));

    expect(response.headers.get("location")).toBeNull();
  });

  it("lets an unauthenticated visitor reach /login", () => {
    const response = middleware(buildRequest("/login"));

    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated access to a protected route to /login", () => {
    const response = middleware(buildRequest("/chats"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });
});
