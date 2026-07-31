import { describe, expect, it } from "vitest";
import { userInfoFromIdToken } from "../entra-user-info";

const base64url = (value: string): string =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const idTokenFor = (claims: Record<string, unknown>): string =>
  `${base64url(JSON.stringify({ alg: "none" }))}.${base64url(JSON.stringify(claims))}.`;

describe("userInfoFromIdToken", () => {
  it("reads the identity out of the id token", () => {
    const result = userInfoFromIdToken({
      idToken: idTokenFor({
        sub: "mock-entra|person@example.com",
        name: "Test Person",
        email: "person@example.com",
        email_verified: true,
      }),
    });

    expect(result?.user).toEqual({
      id: "mock-entra|person@example.com",
      name: "Test Person",
      email: "person@example.com",
      emailVerified: true,
    });
  });

  it("lowercases the email so it matches the account key", () => {
    const result = userInfoFromIdToken({
      idToken: idTokenFor({ sub: "abc", email: "Person@Example.com" }),
    });

    expect(result?.user.email).toBe("person@example.com");
  });

  it("falls back to preferred_username when the email claim is absent", () => {
    const result = userInfoFromIdToken({
      idToken: idTokenFor({ sub: "abc", preferred_username: "person@example.com" }),
    });

    expect(result?.user.email).toBe("person@example.com");
  });

  it("treats a missing email_verified claim as unverified", () => {
    const result = userInfoFromIdToken({
      idToken: idTokenFor({ sub: "abc", email: "person@example.com" }),
    });

    expect(result?.user.emailVerified).toBe(false);
  });

  it("returns null when there is no id token", () => {
    expect(userInfoFromIdToken({})).toBeNull();
  });

  it("returns null when no address can be resolved", () => {
    expect(userInfoFromIdToken({ idToken: idTokenFor({ sub: "abc" }) })).toBeNull();
  });

  it("returns null for a malformed token rather than throwing", () => {
    expect(userInfoFromIdToken({ idToken: "not-a-jwt" })).toBeNull();
    expect(userInfoFromIdToken({ idToken: "a.!!!not-base64!!!.c" })).toBeNull();
  });
});
