import type { Result } from "../result";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface IEmailSender {
  // Resolves the configured transport at send time so admins can update SMTP
  // settings without a restart. Returns a DomainError rather than throwing when
  // email is unconfigured or the transport rejects the message.
  send(input: SendEmailInput): Promise<Result<true>>;

  // True when a transport is fully configured (env credentials or complete admin
  // settings). Lets callers offer a manual fallback instead of silently queuing a
  // notification that can never be delivered.
  isConfigured(): Promise<boolean>;
}
