import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { resolve } from "node:path";

// The rule in `eslint.config.mjs` is the thing that actually holds ADR-045 §4:
// nothing compares an approval status to a literal today, and this is what
// stops the first one that tries. Testing the config through ESLint itself —
// rather than asserting on the config object — is the only way to know the
// selector matches what it claims to.
const lintSource = async (source: string) => {
  const eslint = new ESLint({
    cwd: resolve(import.meta.dirname, "../../../.."),
    overrideConfigFile: resolve(import.meta.dirname, "../../../../eslint.config.mjs"),
  });
  const [result] = await eslint.lintText(source, {
    // Under apps/**, where the rule applies, and not a test file.
    filePath: resolve(import.meta.dirname, "approval-status-lint-fixture.ts"),
  });
  return result?.messages ?? [];
};

const approvalStatusErrors = (messages: Awaited<ReturnType<typeof lintSource>>) =>
  messages.filter((message) => message.ruleId === "no-restricted-syntax");

describe("the approval-status lint rule", () => {
  it("rejects comparing an approval status to a literal", async () => {
    const messages = await lintSource(
      `export const isDone = (approval: { status: string }) => approval.status === "approved";\n`,
    );

    const errors = approvalStatusErrors(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("isApproved");
  });

  it("rejects the comparison written the other way round", async () => {
    const messages = await lintSource(
      `export const isDone = (approval: { status: string }) => "rejected" !== approval.status;\n`,
    );

    expect(approvalStatusErrors(messages)).toHaveLength(1);
  });

  it("allows reading the decision, which keeps its three values", async () => {
    const messages = await lintSource(
      `export const advances = (input: { decision: string }) => input.decision === "approved";\n`,
    );

    expect(approvalStatusErrors(messages)).toHaveLength(0);
  });

  it("allows the decided guard, which stays correct with a fourth decided value", async () => {
    const messages = await lintSource(
      `export const isPending = (approval: { status: string }) => approval.status === "pending";\n`,
    );

    expect(approvalStatusErrors(messages)).toHaveLength(0);
  });

  it("allows a session status, which is a different vocabulary", async () => {
    const messages = await lintSource(
      `export const isLive = (session: { status: string }) => session.status === "active";\n`,
    );

    expect(approvalStatusErrors(messages)).toHaveLength(0);
  });
});
