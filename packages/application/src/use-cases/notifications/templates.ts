// Pure subject/body builders for the two notification triggers. Template
// literals only — no templating framework, so the application layer keeps its
// domain+shared-only import rule. Bodies stay minimal (names + link) to keep
// PII out of email (PRD §12).

import type { FlowPermissionRole } from "@rbrasier/domain";

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface SessionCompleteEmailInput {
  flowName: string;
  sessionTitle: string | null;
  sessionUrl: string;
}

export interface StepCompleteEmailInput {
  flowName: string;
  stepName: string;
  sessionTitle: string | null;
  sessionUrl: string;
}

export interface FlowSharedEmailInput {
  flowName: string;
  granterName: string | null;
  role: FlowPermissionRole;
  flowUrl: string;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const buildSessionCompleteEmail = (
  input: SessionCompleteEmailInput,
): EmailContent => {
  const sessionName = input.sessionTitle ?? input.flowName;
  return {
    subject: `Your '${input.flowName}' session is complete`,
    text: [
      `Your session '${sessionName}' in the '${input.flowName}' flow is complete.`,
      "",
      `Open it here: ${input.sessionUrl}`,
    ].join("\n"),
    html: [
      `<p>Your session '${escapeHtml(sessionName)}' in the '${escapeHtml(input.flowName)}' flow is complete.</p>`,
      `<p><a href="${escapeHtml(input.sessionUrl)}">Open the session</a></p>`,
    ].join("\n"),
  };
};

export const buildStepCompleteEmail = (input: StepCompleteEmailInput): EmailContent => {
  const sessionName = input.sessionTitle ?? input.flowName;
  return {
    subject: `Step '${input.stepName}' is complete in '${input.flowName}'`,
    text: [
      `The step '${input.stepName}' in your '${sessionName}' session ('${input.flowName}' flow) is complete.`,
      "",
      `Open it here: ${input.sessionUrl}`,
    ].join("\n"),
    html: [
      `<p>The step '${escapeHtml(input.stepName)}' in your '${escapeHtml(sessionName)}' session ('${escapeHtml(input.flowName)}' flow) is complete.</p>`,
      `<p><a href="${escapeHtml(input.sessionUrl)}">Open the session</a></p>`,
    ].join("\n"),
  };
};

export const buildFlowSharedEmail = (input: FlowSharedEmailInput): EmailContent => {
  const granter = input.granterName ?? "Someone";
  return {
    subject: `${granter} shared the '${input.flowName}' flow with you`,
    text: [
      `${granter} shared the '${input.flowName}' flow with you and assigned you the '${input.role}' role.`,
      "",
      `Open it here: ${input.flowUrl}`,
    ].join("\n"),
    html: [
      `<p>${escapeHtml(granter)} shared the '${escapeHtml(input.flowName)}' flow with you and assigned you the '${input.role}' role.</p>`,
      `<p><a href="${escapeHtml(input.flowUrl)}">Open the flow</a></p>`,
    ].join("\n"),
  };
};
