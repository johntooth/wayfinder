import { describe, expect, it } from "vitest";
import {
  buildEnvTransportOptions,
  fetchM365AccessToken,
  type SmtpEnvConfig,
} from "./smtp-transport";

const makeConfig = (overrides: Partial<SmtpEnvConfig> = {}): SmtpEnvConfig => ({
  mode: "smtp",
  host: "relay.example.com",
  port: 2525,
  secure: false,
  user: "wayfinder",
  pass: "secret",
  from: "noreply@example.com",
  m365TenantId: null,
  m365ClientId: null,
  m365ClientSecret: null,
  ...overrides,
});

describe("buildEnvTransportOptions", () => {
  it("maps smtp mode to host/port/secure with basic auth", () => {
    const result = buildEnvTransportOptions(makeConfig(), null);

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      host: "relay.example.com",
      port: 2525,
      secure: false,
      auth: { user: "wayfinder", pass: "secret" },
    });
  });

  it("defaults smtp port to 587 when unset", () => {
    const result = buildEnvTransportOptions(makeConfig({ port: null }), null);

    expect(result.data).toMatchObject({ port: 587 });
  });

  it("fails smtp mode when host or credentials are missing", () => {
    expect(buildEnvTransportOptions(makeConfig({ host: null }), null).error?.code).toBe(
      "VALIDATION_FAILED",
    );
    expect(buildEnvTransportOptions(makeConfig({ user: null }), null).error?.code).toBe(
      "VALIDATION_FAILED",
    );
    expect(buildEnvTransportOptions(makeConfig({ pass: null }), null).error?.code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("maps oauth2 mode to XOAUTH2 auth with the M365 defaults", () => {
    const config = makeConfig({ mode: "oauth2", host: null, port: null, user: null, pass: null });

    const result = buildEnvTransportOptions(config, "token-123");

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: { type: "OAuth2", user: "noreply@example.com", accessToken: "token-123" },
    });
  });

  it("prefers an explicit SMTP_USER as the oauth2 mailbox over SMTP_FROM", () => {
    const config = makeConfig({ mode: "oauth2", user: "mailbox@example.com" });

    const result = buildEnvTransportOptions(config, "token-123");

    expect(result.data).toMatchObject({
      host: "relay.example.com",
      auth: { user: "mailbox@example.com" },
    });
  });

  it("fails oauth2 mode without an access token or mailbox", () => {
    const config = makeConfig({ mode: "oauth2" });

    expect(buildEnvTransportOptions(config, null).error?.code).toBe("VALIDATION_FAILED");
    expect(
      buildEnvTransportOptions(makeConfig({ mode: "oauth2", user: null, from: null }), "t").error
        ?.code,
    ).toBe("VALIDATION_FAILED");
  });

  it("maps stream mode to a buffered stream transport", () => {
    const result = buildEnvTransportOptions(makeConfig({ mode: "stream" }), null);

    expect(result.data).toEqual({ streamTransport: true, buffer: true, newline: "unix" });
  });
});

describe("fetchM365AccessToken", () => {
  const config = makeConfig({
    mode: "oauth2",
    m365TenantId: "tenant-1",
    m365ClientId: "client-1",
    m365ClientSecret: "secret-1",
  });

  it("posts client credentials to the tenant token endpoint and returns the token", async () => {
    let requestedUrl = "";
    let requestedBody = "";
    const fakeFetch: typeof fetch = async (url, init) => {
      requestedUrl = String(url);
      requestedBody = String(init?.body);
      return new Response(JSON.stringify({ access_token: "token-abc", expires_in: 3599 }), {
        status: 200,
      });
    };

    const result = await fetchM365AccessToken(config, fakeFetch);

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ accessToken: "token-abc", expiresInSeconds: 3599 });
    expect(requestedUrl).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    expect(requestedBody).toContain("grant_type=client_credentials");
    expect(requestedBody).toContain("client_id=client-1");
    expect(requestedBody).toContain(encodeURIComponent("https://outlook.office365.com/.default"));
  });

  it("fails when the M365 credentials are incomplete", async () => {
    const result = await fetchM365AccessToken(makeConfig({ mode: "oauth2" }), fetch);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("fails when the token endpoint rejects the request", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });

    const result = await fetchM365AccessToken(config, fakeFetch);

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
