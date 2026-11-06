import { describe, expect, it } from "vitest";
import { COGNITO_ERROR_CALLBACK_URL, cognitoSignInErrorMessage } from "./sso-sign-in-errors";

const provider = "Agency SSO";

describe("cognitoSignInErrorMessage", () => {
  // Sign-up is off for Cognito: the person has a pool account but no Wayfinder
  // one yet, and only an administrator can fix that.
  it("tells someone with no Wayfinder account to ask an administrator", () => {
    const message = cognitoSignInErrorMessage("cognito", "signup_disabled", provider);

    expect(message).toMatch(/no Wayfinder account/i);
    expect(message).toMatch(/administrator/i);
    expect(message).toContain(provider);
  });

  // Cognito is not a trusted provider, so Better Auth refuses to link an
  // address the pool has not verified.
  it("tells someone whose address the pool has not verified to verify it first", () => {
    const message = cognitoSignInErrorMessage("cognito", "account_not_linked", provider);

    expect(message).toMatch(/verif/i);
    expect(message).toContain(provider);
  });

  // The code comes from the URL, so it is never shown; an unknown one gets a
  // fixed message rather than a silent form after a failed redirect.
  it("gives a fixed message for any other code, without echoing it", () => {
    const message = cognitoSignInErrorMessage("cognito", "<script>alert(1)</script>", provider);

    expect(message).toMatch(/did not complete/i);
    expect(message).not.toContain("script");
  });

  it("does not resolve a code through the object prototype", () => {
    expect(cognitoSignInErrorMessage("cognito", "constructor", provider)).toMatch(/did not complete/i);
    expect(cognitoSignInErrorMessage("cognito", "__proto__", provider)).toMatch(/did not complete/i);
  });

  it("ignores an error that did not come back from a Cognito sign-in", () => {
    expect(cognitoSignInErrorMessage(null, "signup_disabled", provider)).toBeNull();
    expect(cognitoSignInErrorMessage("other", "signup_disabled", provider)).toBeNull();
  });

  it("ignores a Cognito return with no error", () => {
    expect(cognitoSignInErrorMessage("cognito", null, provider)).toBeNull();
  });

  it("returns to the login page marked as a Cognito sign-in", () => {
    expect(COGNITO_ERROR_CALLBACK_URL).toBe("/login?sso=cognito");
  });
});
