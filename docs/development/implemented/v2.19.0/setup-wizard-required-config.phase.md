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
| web (test) | `lib/e2e-fixtures.ts` | Seeds a placeholder AI key when nothing is configured, so the step-2 gate is deterministic on CI runs without the `ANTHROPIC_API_KEY` secret. |

## 3. Deployment fork (step 1)

`multiOrganisation` in `DeploymentConfig` recorded the wizard's answer but never
touched `organisations_enabled` (ADR-038), so choosing "multiple organisations"
had no effect on the running app. Continue now writes both, and in the multi
branch also creates the admin's own organisation — "multiple organisations" with
zero organisations in the database is not a coherent state to leave setup in.

## 4. Required configuration (step 2)

`settings.getSetupStatus` already reported per-requirement configured state and
was unused by the wizard; it now drives both the indicators and the Continue
gate. "Configured" means a value is present from env or the database — the same
meaning it had before; the wizard does not require a passing connectivity test.

## 5. Out of scope

- No schema migration. Every value written here is existing runtime settings state.
- Feature-flag defaults are unchanged: `extraction_flows` on, `skills`/`mcp` off.
  Only their wizard toggles are removed.
