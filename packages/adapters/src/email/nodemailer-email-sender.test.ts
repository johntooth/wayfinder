import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type ISystemSettingsRepository,
  type Result,
  type SystemSetting,
} from "@rbrasier/domain";
import { NodemailerEmailSender } from "./nodemailer-email-sender";
import type { SmtpEnvConfig } from "./smtp-transport";

class FakeSystemSettingsRepository implements ISystemSettingsRepository {
  values = new Map<string, string>();

  async get(key: string): Promise<Result<SystemSetting | null>> {
    const value = this.values.get(key);
    if (value === undefined) return ok(null);
    return ok({ id: key, key, value, createdAt: new Date(0), updatedAt: new Date(0) });
  }

  async set(): Promise<Result<SystemSetting>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
}

const makeEnvConfig = (overrides: Partial<SmtpEnvConfig> = {}): SmtpEnvConfig => ({
  mode: "stream",
  host: null,
  port: null,
  secure: false,
  user: null,
  pass: null,
  from: "noreply@example.com",
  m365TenantId: null,
  m365ClientId: null,
  m365ClientSecret: null,
  ...overrides,
});

describe("NodemailerEmailSender with environment transport config", () => {
  it("sends through the stream sink without touching admin settings", async () => {
    const sender = new NodemailerEmailSender(new FakeSystemSettingsRepository(), makeEnvConfig());

    const result = await sender.send({
      to: "recipient@example.com",
      subject: "Hello",
      text: "Body",
      html: "<p>Body</p>",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toBe(true);
  });

  it("fails when SMTP_FROM is missing", async () => {
    const sender = new NodemailerEmailSender(
      new FakeSystemSettingsRepository(),
      makeEnvConfig({ from: null }),
    );

    const result = await sender.send({ to: "r@example.com", subject: "S", text: "T" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("fails smtp mode when transport variables are incomplete", async () => {
    const sender = new NodemailerEmailSender(
      new FakeSystemSettingsRepository(),
      makeEnvConfig({ mode: "smtp" }),
    );

    const result = await sender.send({ to: "r@example.com", subject: "S", text: "T" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("NodemailerEmailSender without environment transport config", () => {
  it("falls back to admin settings and fails when email is unconfigured", async () => {
    const sender = new NodemailerEmailSender(new FakeSystemSettingsRepository());

    const result = await sender.send({ to: "r@example.com", subject: "S", text: "T" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("not configured");
  });
});
