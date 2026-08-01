import { describe, expect, it, vi, beforeEach } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";

const { authenticate, container } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  container: { pkiCertAdapter: null as { authenticate: unknown } | null },
}));

vi.mock("@/lib/container", () => ({ getContainer: () => container }));

import { GET, POST } from "./route";

const TRUSTED_PROXY_IP = "10.0.0.1";

const certRequest = (method: "GET" | "POST", redirect = "/admin"): Request =>
  new Request(`http://localhost:3000/api/auth/cert?redirect=${encodeURIComponent(redirect)}`, {
    method,
    headers: {
      "x-forwarded-for": TRUSTED_PROXY_IP,
      "x-ssl-client-verified": "SUCCESS",
      "x-ssl-client-subject-dn": "CN=Jane Smith,O=Acme",
      "x-ssl-client-fingerprint": "sha256:abc123",
      "x-ssl-client-san-email": "jane@acme.com",
    },
  });

describe("/api/auth/cert", () => {
  beforeEach(() => {
    authenticate.mockReset();
    container.pkiCertAdapter = { authenticate };
  });

  // middleware.ts sends unauthenticated browsers here with a plain navigation
  // when AUTH_METHOD names PKI. A POST-only route answered 405, so the redirect
  // it issues was a dead end and certificate sign-in never completed.
  describe("GET — the method middleware actually redirects with", () => {
    it("signs in and redirects onward instead of rejecting the method", async () => {
      authenticate.mockResolvedValue(ok({ token: "session-token", userId: "user-1" }));

      const response = await GET(certRequest("GET", "/admin/flows"));

      expect(response.status).toBe(302);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/admin/flows");
      expect(response.cookies.get("better-auth.session_token")?.value).toBe("session-token");
    });

    it("passes the certificate headers and the proxy IP through to the adapter", async () => {
      authenticate.mockResolvedValue(ok({ token: "session-token", userId: "user-1" }));

      await GET(certRequest("GET"));

      const call = authenticate.mock.calls[0];
      expect(call).toBeDefined();
      const [headers, sourceIp] = call as [Headers, string];
      expect(sourceIp).toBe(TRUSTED_PROXY_IP);
      expect(headers.get("x-ssl-client-san-email")).toBe("jane@acme.com");
    });

    it("returns 401 rather than a session when the proxy is not trusted", async () => {
      authenticate.mockResolvedValue(
        err(domainError("UNAUTHORIZED", "Request did not originate from a trusted proxy.")),
      );

      const response = await GET(certRequest("GET"));

      expect(response.status).toBe(401);
      expect(response.cookies.get("better-auth.session_token")).toBeUndefined();
    });

    it("returns 404 when PKI auth is not enabled", async () => {
      container.pkiCertAdapter = null;

      const response = await GET(certRequest("GET"));

      expect(response.status).toBe(404);
    });
  });

  describe("POST — the method the mock proxy and direct callers use", () => {
    it("still signs in, so both entry points share one implementation", async () => {
      authenticate.mockResolvedValue(ok({ token: "session-token", userId: "user-1" }));

      const response = await POST(certRequest("POST", "/chats"));

      expect(response.status).toBe(302);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/chats");
      expect(response.cookies.get("better-auth.session_token")?.value).toBe("session-token");
    });
  });

  describe("redirect target", () => {
    it("refuses an absolute redirect so the route cannot be used as an open redirector", async () => {
      authenticate.mockResolvedValue(ok({ token: "session-token", userId: "user-1" }));

      const response = await GET(certRequest("GET", "//evil.example.com/x"));

      const location = new URL(response.headers.get("location") ?? "");
      expect(location.host).toBe("localhost:3000");
      expect(location.pathname).toBe("/");
    });
  });
});
