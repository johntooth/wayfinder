# Implementation Summary — Setup Wizard: Required Configuration & Deployment Fork

- **Version**: 2.19.0 (MINOR — behavioural change to an admin feature plus new
  default model configuration; no schema migration)
- **Phase doc**: `setup-wizard-required-config.phase.md`
- **E2E coverage**: `apps/web/e2e/phase-admin-first-login-setup.spec.ts`

## What changed

**Step 1 — deployment fork.** Two choice buttons replace the multi-organisation
checkbox. Continue is disabled until one is picked, then commits the choice
without a separate Save: it writes `DeploymentConfig.multiOrganisation` *and*
`organisations_enabled`, and on the multi branch creates the admin's own
organisation via the new `organisation.createForSelf` mutation. The single
branch reuses `OrganisationNameCard` unchanged apart from an optional
`onValueChange` that lets Continue persist the field.

**Step 2 — required, and gated on the live test.** Continue is gated on each
requirement being configured *and* having passed its connectivity probe. Each
card carries a state indicator above it (`WizardRequirement`). A secondary Skip
opens a warning dialog stating both that the settings can be configured at any
time and that Wayfinder will not be functional until they are; confirming exits
the wizard and marks onboarding complete.

**Amazon S3 addressing.** `StorageConfig` gains `region` and `pathStyle`,
surfaced as a single MinIO / Amazon S3 storage-type choice in the card. Both
client construction sites now share one options builder instead of hardcoding
path-style addressing.

**Step 3 — confirmation only.** All feature-flag toggles and the email/n8n cards
are gone, along with the Skip button. Synthesise Information is unchanged — it
was already on by default via `DEFAULT_ENABLED_FLAGS`, so removing its toggle
removes UI, not behaviour.

**AI defaults.** Anthropic now defaults to `claude-sonnet-5` for chat and
branching and `claude-opus-5` for document generation, with Bedrock on the same
models under their `anthropic.`-prefixed ids. Context windows (1M) and per-token
rates are registered for all four.

**AI modal segmentation.** The edit modal renders only the selected provider's
credential fields, and the card summary shows only that provider's state.

## Notes and decisions

- **`organisations_enabled` was the missing half of step 1.** `DeploymentConfig`
  recorded the wizard's answer, but the nav, settings page and membership
  resolution all read `organisations_enabled` (ADR-038). Writing only the former
  meant "multiple organisations" changed nothing observable. Continue now writes
  both.
- **`createForSelf` is a router-level composition, not a new use case.** It calls
  the existing `CreateOrganisation` and `AssignUserOrganisation` use cases and
  takes the user id from `ctx`, so the client never has to know its own id. It
  guards `ctx.userId` explicitly because `adminProcedure` proves admin rights
  without narrowing the id's type the way `authenticatedProcedure` does.
- **Storage and AI cards now invalidate `getSetupStatus` on save.** Without it
  the step-2 gate would not reopen until a refetch — the admin would save the
  last requirement and find Continue still disabled.
- **`getSetupStatus` already existed and was unused.** It was built for this in
  v2.18.0; this phase wires it up rather than adding a second status source.
- **"Configured" was never a usable gate.** Every storage field has an env
  default, so `isStorageConfigured` returns true on a machine with no object
  storage at all — the first cut of this gate could not block anyone. The live
  Test is the only signal those defaults cannot fake, which is what ADR-041 §2
  said in the first place.
- **An unsupported probe has to count as a pass.** `probeAiConnectivity`
  deliberately reports Bedrock as skipped, so a strict `ok` requirement would
  make setup uncompletable on every Bedrock install. `isRequirementSatisfied`
  accepts `passed` or `unsupported`.
- **Step 3 has no e2e path any more.** Reaching it needs a passing AI probe,
  which runs server-side against the real provider API and cannot pass with CI's
  placeholder credentials. The gate logic is unit-tested in
  `wizard-requirements.test.ts` instead; the e2e spec covers the fork, the block,
  and the skip exit.
- **The region is omitted, not blanked, when unset.** The minio client signs with
  whatever region it is handed, so passing `""` would break requests that its own
  per-bucket `GetBucketLocation` discovery handles fine for MinIO.
- **Bedrock ids use the short `anthropic.claude-*` form.** That is the documented
  Bedrock identifier for the Claude 5 line. Deployments on the legacy
  InvokeModel id format can edit the model fields in the AI modal, which are
  free text.

## Validation

`./validate.sh` — all checks pass. `VERSION` and root `package.json` are `2.19.0`.
