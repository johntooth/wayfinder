import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/with-root-env.sh is what `pnpm dev` and `pnpm start` in this app run
// through: Turborepo 2.x runs tasks in strict environment mode, so a variable
// exported by restart.sh never reaches `next dev`. The loader reads the
// repo-root .env itself, the same way apps/api does with dotenv.
const loaderSource = fileURLToPath(new URL("../../../../scripts/with-root-env.sh", import.meta.url));

// The loader resolves the repo root from its own location, so a copy inside a
// temporary directory gives each case an isolated .env instead of whatever the
// developer happens to have checked out.
const stageLoader = (envFileContents?: string): string => {
  const root = mkdtempSync(join(tmpdir(), "with-root-env-"));
  mkdirSync(join(root, "scripts"));
  const staged = join(root, "scripts", "with-root-env.sh");
  copyFileSync(loaderSource, staged);
  chmodSync(staged, 0o755);
  if (envFileContents !== undefined) writeFileSync(join(root, ".env"), envFileContents);
  return root;
};

// Only PATH, so the file under test is the only source of anything else.
const minimalEnvironment = (extra: Record<string, string>): NodeJS.ProcessEnv => ({
  NODE_ENV: process.env.NODE_ENV,
  PATH: process.env["PATH"] ?? "",
  ...extra,
});

const readVariableThroughLoader = (
  root: string,
  variable: string,
  environment: Record<string, string> = {},
): string =>
  execFileSync(
    join(root, "scripts", "with-root-env.sh"),
    ["node", "-e", `process.stdout.write(String(process.env.${variable}))`],
    { encoding: "utf8", env: minimalEnvironment(environment) },
  );

describe("with-root-env.sh", () => {
  it("gives the command a variable that exists only in the repo-root .env", () => {
    const root = stageLoader("DATABASE_URL=postgresql://postgres:postgres@localhost:5433/wayfinder\n");

    expect(readVariableThroughLoader(root, "DATABASE_URL")).toBe(
      "postgresql://postgres:postgres@localhost:5433/wayfinder",
    );
  });

  it("does not overwrite a variable the caller already set", () => {
    const root = stageLoader("DATABASE_URL=postgresql://from-file@localhost:5433/wayfinder\n");

    const value = readVariableThroughLoader(root, "DATABASE_URL", {
      DATABASE_URL: "postgresql://from-caller@localhost:5433/wayfinder",
    });

    expect(value).toBe("postgresql://from-caller@localhost:5433/wayfinder");
  });

  it("runs the command unchanged when there is no .env to load", () => {
    const root = stageLoader();

    expect(readVariableThroughLoader(root, "DATABASE_URL")).toBe("undefined");
  });

  it("ignores comments and blank lines, and strips quotes and an export prefix", () => {
    const root = stageLoader(
      ["# a comment", "", "export QUOTED_VALUE='quoted'", 'DOUBLE_QUOTED="double"'].join("\n"),
    );

    expect(readVariableThroughLoader(root, "QUOTED_VALUE")).toBe("quoted");
    expect(readVariableThroughLoader(root, "DOUBLE_QUOTED")).toBe("double");
  });

  // A base64 SETTINGS_ENCRYPTION_KEY ends in "=" padding, and a DATABASE_URL can
  // carry "=" inside a query parameter. Only the first "=" separates the name.
  it("keeps an = inside the value", () => {
    const root = stageLoader("SETTINGS_ENCRYPTION_KEY=c2VjcmV0LXZhbHVlLXBhZGRlZC10by0zMi1ieXRlcw==\n");

    expect(readVariableThroughLoader(root, "SETTINGS_ENCRYPTION_KEY")).toBe(
      "c2VjcmV0LXZhbHVlLXBhZGRlZC10by0zMi1ieXRlcw==",
    );
  });

  it("propagates the command's exit code", () => {
    const root = stageLoader("DATABASE_URL=postgresql://postgres@localhost:5433/wayfinder\n");

    try {
      execFileSync(join(root, "scripts", "with-root-env.sh"), ["node", "-e", "process.exit(3)"], {
        encoding: "utf8",
        env: minimalEnvironment({}),
      });
      expect.unreachable("the loader should have exited non-zero");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(3);
    }
  });
});
