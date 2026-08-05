import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveMigrationsFolder } from "./migrate";

describe("resolveMigrationsFolder", () => {
  it("prefers an explicitly supplied folder over everything else", () => {
    const explicit = "/somewhere/explicit/drizzle";

    const resolved = resolveMigrationsFolder({
      explicitFolder: explicit,
      environmentFolder: "/from/the/environment",
    });

    expect(resolved).toBe(explicit);
  });

  it("falls back to the environment override when no folder is supplied", () => {
    const fromEnvironment = "/from/the/environment";

    const resolved = resolveMigrationsFolder({ environmentFolder: fromEnvironment });

    expect(resolved).toBe(fromEnvironment);
  });

  it("finds the generated migrations in the workspace layout", () => {
    const resolved = resolveMigrationsFolder();

    expect(existsSync(resolved)).toBe(true);
    expect(existsSync(join(resolved, "meta", "_journal.json"))).toBe(true);
  });

  it("resolves to a folder that actually contains SQL migrations", () => {
    const resolved = resolveMigrationsFolder();

    expect(existsSync(join(resolved, "0000_premium_ikaris.sql"))).toBe(true);
  });

  it("throws a descriptive error when no candidate folder exists", () => {
    expect(() => resolveMigrationsFolder({ candidateFolders: ["/no/such/folder"] })).toThrowError(
      /could not locate the generated migrations/i,
    );
  });

  it("names the candidates it tried so a container misconfiguration is diagnosable", () => {
    expect(() =>
      resolveMigrationsFolder({ candidateFolders: ["/first/guess", "/second/guess"] }),
    ).toThrowError(/\/first\/guess.*\/second\/guess/s);
  });
});
