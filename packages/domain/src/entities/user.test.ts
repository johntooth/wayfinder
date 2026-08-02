import { describe, expect, it } from "vitest";
import { normaliseEmail } from "./user";

describe("normaliseEmail", () => {
  it("lowercases so one address resolves to one account", () => {
    expect(normaliseEmail("Person@Example.com")).toBe("person@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseEmail("  person@example.com  ")).toBe("person@example.com");
  });

  it("leaves an already normalised address untouched", () => {
    expect(normaliseEmail("person@example.com")).toBe("person@example.com");
  });

  it("normalises the certificate and identity-provider spellings to the same key", () => {
    expect(normaliseEmail("P.Person@EXAMPLE.COM")).toBe(normaliseEmail("p.person@example.com"));
  });

  it("returns an empty string unchanged", () => {
    expect(normaliseEmail("")).toBe("");
  });
});
