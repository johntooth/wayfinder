# Phase — Setup Wizard: Required Configuration & Deployment Fork

- **Status**: Implemented (v2.19.0)
- **Target version**: 2.19.0 — **MINOR** (behavioural change to an admin feature
  plus new default model configuration; no schema migration).
- **Enhances**: `docs/development/implemented/v2.18.0/admin-first-login-setup.phase.md`
- **ADR**: `docs/development/adr/041-first-run-onboarding-and-db-first-config.adr.md`

## 1. Goal

The v2.18.0 wizard treated all three steps as advisory: every step could be
skipped, step 1 exposed a bare "multiple organisations" checkbox that changed
nothing observable, and step 3 offered feature toggles for surfaces an admin has
no basis to decide on during first run.

This enhancement makes the wizard reflect what Wayfinder actually requires:

- Step 1 is a **fork**, not a toggle. Choosing "one organisation" or "multiple
  organisations" leads to different, meaningful configuration.
- Step 2 is **required**. Wayfinder cannot run a session without object storage
  and an AI provider, so Continue is gated on both, with a visible required /
  configured indicator and an explicit, warned Skip.
- Step 3 is **confirmation only**. Synthesise Information ships on by default;
  Skills, MCP, n8n and email are configuration-page concerns, not first-run ones.

It also refreshes the AI defaults to the Claude 5 line and narrows the AI
configuration modal to the fields that apply to the selected provider.

## 2. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| adapters | `config/runtime-config-store.ts` | `DEFAULT_MODELS_FOR.anthropic` → chat/branching `claude-sonnet-5`, document generation `claude-opus-5`; `DEFAULT_MODELS_FOR.bedrock` → the same models under `anthropic.`-prefixed ids. `MODEL_CONTEXT_WINDOWS` gains 1M-token entries for all four so budgets are never estimated. Tests first. |
| adapters | `ai/providers.ts` | Per-provider `defaultModel` fallbacks aligned to the same models. |
| adapters | `observability/usage-tracking-adapter.ts` | Rates for `claude-opus-5` ($5/$25 per MTok) and `claude-sonnet-5` ($3/$15), plus their Bedrock twins, so cost tracking does not fall back to a shared estimate. Tests first. |
| web (tRPC) | `server/routers/organisation.ts` | New `createForSelf` mutation: creates an organisation and assigns the calling admin to it in one call, composing the existing `CreateOrganisation` + `AssignUserOrganisation` use cases. Takes the user from `ctx` so the client never handles its own id. |
| web (UI) | `components/onboarding/wizard-deployment-step.tsx` | New. Two choice buttons; "one organisation" reveals the reused `OrganisationNameCard`, "multiple organisations" asks which organisation the admin belongs to. |
| web (UI) | `components/onboarding/wizard-requirement.tsx` | New. Required / configured indicator rendered above each gated step-2 card. |
| web (UI) | `components/onboarding/wizard-skip-dialog.tsx` | New. Warns that the settings are configurable later but that the app will not be functional until they are set. |
| web (UI) | `components/onboarding/setup-wizard.tsx` | Rewritten steps. Continue commits step 1; step 2 gates on `getSetupStatus`; step 3 is a completion message. All feature-flag toggles removed. |
| web (UI) | `components/settings/ai-provider-card.tsx` | Modal shows only the selected provider's credentials; card summary likewise. |
| web (UI) | `components/settings/organisation-name-card.tsx` | Optional `onValueChange` so the wizard can auto-save on Continue; placeholder is now `e.g. Acme Corporation`. |
| web (UI) | `components/settings/storage-card.tsx`, `ai-provider-card.tsx` | Saving also invalidates `getSetupStatus`, so the step-2 gate reopens as soon as a requirement is met. |
| web (UI) | `components/onboarding/wizard-requirements.ts` | New. Pure resolution of a requirement's state from configured + probe status, and whether that state may pass the gate. Unit tested. |
| domain | `entities/runtime-config.ts` | `StorageConfig` gains `region` and `pathStyle`. `isStorageConfigured` additionally requires a region once `pathStyle` is off. Tests first. |
| adapters | `storage/minio-client-options.ts` | New. Shared client options builder used by both the storage adapter and the connectivity probe, which each previously hardcoded `pathStyle: true`. Tests first. |
| adapters | `config/runtime-config-store.ts` | `parseStorageConfig` reads the two new fields; an empty region is honoured rather than replaced from the fallback. |
| web | `lib/env.ts`, `lib/container.ts` | `MINIO_REGION` (default empty) and `MINIO_PATH_STYLE` (default true), threaded into the env defaults. |
| web (tRPC) | `server/routers/settings.ts` | Storage input schema gains both fields and refuses a blank region when `pathStyle` is off. |
| web (UI) | `components/settings/storage-card.tsx` | Storage-type selector (MinIO / S3-compatible vs Amazon S3) driving `pathStyle`, plus a region field. |

## 3. Deployment fork (step 1)

`multiOrganisation` in `DeploymentConfig` recorded the wizard's answer but never
touched `organisations_enabled` (ADR-038), so choosing "multiple organisations"
had no effect on the running app. Continue now writes both, and in the multi
branch also creates the admin's own organisation — "multiple organisations" with
zero organisations in the database is not a coherent state to leave setup in.

## 4. Required configuration (step 2)

Gating on "configured" alone is not a gate at all: every storage field carries an
env default (`localhost`, `minioadmin`, `wayfinder-documents`), so a fresh
install with no object storage anywhere reads as fully configured. ADR-041 §2
always said the wizard should require the live Test — this implements that.

A requirement passes when it is configured **and** its probe returned `ok`, or
when the probe reports itself unsupported. The second case is load-bearing:
`probeAiConnectivity` deliberately skips Bedrock, because a real check needs
SigV4-signed control-plane calls, so gating strictly on `ok` would lock every
Bedrock install out of setup permanently.

## 5. Amazon S3 addressing

`StorageConfig` previously described only what MinIO needs, and both client
construction sites hardcoded `pathStyle: true`. That is correct for MinIO and
wrong for Amazon S3, which deprecated path-style addressing. Two fields close the
gap — `region`, which S3 signs with, and `pathStyle` — surfaced in the UI as a
single storage-type choice rather than as two settings an admin has to reason
about. The region is omitted from the client options entirely when blank, since
the client signs with whatever it is given and an empty region would break
requests that its own per-bucket discovery would otherwise handle.

## 6. Out of scope

- No schema migration. Every value written here is existing runtime settings state.
- Feature-flag defaults are unchanged: `extraction_flows` on, `skills`/`mcp` off.
  Only their wizard toggles are removed.
