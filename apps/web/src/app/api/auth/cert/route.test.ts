import { describe, expect, it, vi, beforeEach } from "vitest";
import { ok, err, domainError, type AuthConfig } from "@rbrasier/domain";

const { authenticate, container, setPkiState } = vi.hoisted(() => {
  let authConfig: AuthConfig = {
    emailPasswordEnabled: true,
    entraEnabled: false,
    entra: { tenantId: "", clientId: "", clientSecret: "" },
    pkiEnabled: true,
    pki: { sessionTtlHours: 8 },
  };
  let envConfigured = true;
  return {
    authenticate: vi.fn(),
    container: {
      pkiCertAdapter: null as { authenticate: unknown } | null,
      runtimeConfig: {
        getAuthConfig: async (): Promise<AuthConfig> => authConfig,
        isPkiEnvConfigured: (): boolean => envConfigured,
      },
    },
    // The route reads the switch and the environment gate on every request, so
    // a spec can move either one between calls.
    setPkiState: (pkiEnabled: boolean, hasTrustedProxies: boolean): void => {
      authConfig = { ...authConfig, pkiEnabled };
      envConfigured = hasTrustedProxies;
    },
  };
});

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
    setPkiState(true, true);
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

    it("returns 403 when certificate sign-in is disabled in config", async () => {
      setPkiState(false, true);

      const response = await GET(certRequest("GET"));

      expect(response.status).toBe(403);
      expect(authenticate).not.toHaveBeenCalled();
    });

    // The switch is on but a later deploy dropped PKI_TRUSTED_PROXY_IPS: just as
    // unable to authenticate anyone, and answered the same way.
    it("returns 403 when enabled but the environment gate is unsatisfied", async () => {
      setPkiState(true, false);

      const response = await GET(certRequest("GET"));

      expect(response.status).toBe(403);
      expect(authenticate).not.toHaveBeenCalled();
    });

    it("returns 500, not 400, when the adapter reports a misconfiguration", async () => {
      authenticate.mockResolvedValue(
        err(domainError("INFRA_FAILURE", "PKI_TRUSTED_PROXY_IPS is not set.")),
      );

      const response = await GET(certRequest("GET"));

      expect(response.status).toBe(500);
      expect(response.cookies.get("better-auth.session_token")).toBeUndefined();
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
