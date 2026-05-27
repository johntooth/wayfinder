import { describe, it, expect } from "vitest";
import type { AuthMethod } from "../better-auth";

describe("AuthMethod discriminated union", () => {
  it("accepts email-password as the default mechanism", () => {
    const method: AuthMethod = { type: "email-password" };
    expect(method.type).toBe("email-password");
  });

  it("accepts pki with config", () => {
    const method: AuthMethod = {
      type: "pki",
      pkiConfig: { trustedProxyIps: ["10.0.0.1"], sessionTtlHours: 8 },
    };
    expect(method.type).toBe("pki");
  });

  it("accepts pki-and-email-password as a combined mode", () => {
    const method: AuthMethod = {
      type: "pki-and-email-password",
      pkiConfig: { trustedProxyIps: ["10.0.0.1"], sessionTtlHours: 8 },
    };
    expect(method.type).toBe("pki-and-email-password");
  });

  it("accepts google-oauth and other", () => {
    const a: AuthMethod = { type: "google-oauth" };
    const b: AuthMethod = { type: "other" };
    expect(a.type).toBe("google-oauth");
    expect(b.type).toBe("other");
  });
});
