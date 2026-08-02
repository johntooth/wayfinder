import { describe, expect, it, vi } from "vitest";
import { resolvePkiEnv, warnOnRejectedProxyEntries } from "./container-auth";

const env = (overrides: Record<string, unknown> = {}) =>
  ({
    AUTH_METHOD: "email-password",
    PKI_SESSION_TTL_HOURS: 8,
    ...overrides,
  }) as Parameters<typeof resolvePkiEnv>[0];

describe("resolvePkiEnv", () => {
  it("keeps addresses and reports the gate as satisfied", () => {
    const resolved = resolvePkiEnv(env({ PKI_TRUSTED_PROXY_IPS: "127.0.0.1, 10.0.0.4" }));

    expect(resolved.trustedProxyIps).toEqual(["127.0.0.1", "10.0.0.4"]);
    expect(resolved.envDefaults.hasTrustedProxies).toBe(true);
  });

  // The reported trap: "localhost" looks right in a .env, but the check
  // compares against a source IP, so it can never match.
  it("drops a hostname and names it as rejected", () => {
    const resolved = resolvePkiEnv(env({ PKI_TRUSTED_PROXY_IPS: "127.0.0.1,localhost" }));

    expect(resolved.trustedProxyIps).toEqual(["127.0.0.1"]);
    expect(resolved.rejectedProxyEntries).toEqual(["localhost"]);
  });

  it("does not count a list of only hostnames as a satisfied gate", () => {
    const resolved = resolvePkiEnv(env({ PKI_TRUSTED_PROXY_IPS: "localhost,proxy.internal" }));

    expect(resolved.envDefaults.hasTrustedProxies).toBe(false);
    expect(resolved.rejectedProxyEntries).toEqual(["localhost", "proxy.internal"]);
  });

  it("ignores blank entries rather than reporting them as rejected", () => {
    const resolved = resolvePkiEnv(env({ PKI_TRUSTED_PROXY_IPS: "127.0.0.1, ," }));

    expect(resolved.trustedProxyIps).toEqual(["127.0.0.1"]);
    expect(resolved.rejectedProxyEntries).toEqual([]);
  });

  it("accepts IPv6", () => {
    const resolved = resolvePkiEnv(env({ PKI_TRUSTED_PROXY_IPS: "::1" }));

    expect(resolved.trustedProxyIps).toEqual(["::1"]);
  });

  it("treats an unset variable as an unsatisfied gate", () => {
    const resolved = resolvePkiEnv(env());

    expect(resolved.trustedProxyIps).toEqual([]);
    expect(resolved.envDefaults.hasTrustedProxies).toBe(false);
  });

  it("seeds pkiEnabled from AUTH_METHOD naming PKI", () => {
    expect(resolvePkiEnv(env({ AUTH_METHOD: "pki" })).authMethodNamesPki).toBe(true);
    expect(resolvePkiEnv(env({ AUTH_METHOD: "pki-and-email-password" })).authMethodNamesPki).toBe(
      true,
    );
    expect(resolvePkiEnv(env()).authMethodNamesPki).toBe(false);
  });
});

describe("warnOnRejectedProxyEntries", () => {
  it("names the ignored entries and says what to use instead", () => {
    const logger = { warn: vi.fn() };

    warnOnRejectedProxyEntries(logger, ["localhost"]);

    const message = logger.warn.mock.calls[0]?.[0] as string;
    expect(message).toContain("localhost");
    expect(message).toContain("source IP");
  });

  it("stays quiet when every entry parsed", () => {
    const logger = { warn: vi.fn() };

    warnOnRejectedProxyEntries(logger, []);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
