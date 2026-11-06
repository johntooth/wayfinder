import { describe, expect, it } from "vitest";
import {
  COGNITO_PROVIDER_ID,
  DEFAULT_COGNITO_DISPLAY_NAME,
  cognitoOAuthConfig,
  cognitoProviderFor,
  isCognitoEmailVerified,
} from "../cognito-provider";

const issuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_AbCdEfGhI";
const complete = { issuer, clientId: "client", clientSecret: "secret" };

describe("cognitoProviderFor", () => {
  it("returns the provider when issuer, client id and secret are all set", () => {
    expect(cognitoProviderFor(complete)).toEqual({
      issuer,
      clientId: "client",
      clientSecret: "secret",
      displayName: DEFAULT_COGNITO_DISPLAY_NAME,
    });
  });

  it("uses the configured display name", () => {
    expect(cognitoProviderFor({ ...complete, displayName: "Agency SSO" })?.displayName).toBe("Agency SSO");
  });

  it("falls back to the default display name when it is blank", () => {
    expect(cognitoProviderFor({ ...complete, displayName: "  " })?.displayName).toBe(DEFAULT_COGNITO_DISPLAY_NAME);
  });

  it("drops a trailing slash from the issuer, which would otherwise fail the iss check", () => {
    expect(cognitoProviderFor({ ...complete, issuer: `${issuer}/` })?.issuer).toBe(issuer);
  });

  it.each([
    { ...complete, issuer: undefined },
    { ...complete, clientId: undefined },
    { ...complete, clientSecret: undefined },
    { ...complete, clientId: "" },
  ])("returns null when any setting is missing (fail closed): %o", (settings) => {
    expect(cognitoProviderFor(settings)).toBeNull();
  });

  // The issuer decides where sign-in tokens come from; plain http would let
  // anyone on the path mint them.
  it("returns null for an issuer that is not https", () => {
    expect(cognitoProviderFor({ ...complete, issuer: "http://cognito.example" })).toBeNull();
  });
});

describe("isCognitoEmailVerified", () => {
  it("accepts the boolean the id token carries", () => {
    expect(isCognitoEmailVerified({ email_verified: true })).toBe(true);
  });

  // Cognito's userinfo endpoint sends the claim as a string, and "false" is
  // truthy: read loosely, an unverified address would count as verified.
  it("accepts the string the userinfo endpoint sends, and only when it says true", () => {
    expect(isCognitoEmailVerified({ email_verified: "true" })).toBe(true);
    expect(isCognitoEmailVerified({ email_verified: "false" })).toBe(false);
  });

  it("treats a missing or false claim as unverified", () => {
    expect(isCognitoEmailVerified({})).toBe(false);
    expect(isCognitoEmailVerified({ email_verified: false })).toBe(false);
  });
});

describe("cognitoOAuthConfig", () => {
  const config = cognitoOAuthConfig({ ...complete, displayName: DEFAULT_COGNITO_DISPLAY_NAME });

  it("discovers the endpoints from the issuer and requires verified id tokens", () => {
    expect(config.providerId).toBe(COGNITO_PROVIDER_ID);
    expect(config.discoveryUrl).toBe(`${issuer}/.well-known/openid-configuration`);
    expect(config.requireIdTokenVerification).toBe(true);
    expect(config.disableIdTokenNonceBinding).toBeUndefined();
  });

  it("uses PKCE and a confidential client", () => {
    expect(config.pkce).toBe(true);
    expect(config.clientId).toBe("client");
    expect(config.clientSecret).toBe("secret");
  });

  it("asks for the OpenID scopes that carry the email address", () => {
    expect(config.scopes).toEqual(["openid", "email", "profile"]);
  });

  // Accounts are made by an admin in Wayfinder; a Cognito sign-in may only
  // link to one that already exists.
  it("never creates an account", () => {
    expect(config.disableSignUp).toBe(true);
  });

  it("reports the address as verified only when Cognito says so", async () => {
    expect(await config.mapProfileToUser?.({ email: "a@example.com", email_verified: "false" })).toEqual({
      emailVerified: false,
    });
    expect(await config.mapProfileToUser?.({ email: "a@example.com", email_verified: true })).toEqual({
      emailVerified: true,
    });
  });
});
