# e2e suite triage — PR #241

The Playwright suite was audited and cut from **121 spec files / 380 tests** to
**33 / 116**. This file records what was removed and why, so the decision can be
revisited per spec rather than re-litigated wholesale.

The rule applied is [`e2e-test-policy.md`](e2e-test-policy.md): a spec survives
only if the behaviour it covers falls into one of six groups that genuinely need
a browser. Everything else belongs at the layer that owns the logic.

## Why the suite grew this way

`/build`, `/enhance` and `/bugfix` each required a new Playwright spec per
ticket — "write it, do not run it". That produced 100 ticket-shaped spec files
(`enhance-*`, `fix-*`, `phase-*`) written against a UI the author never observed.
A spec written blind cannot be trusted to pass, so it was wrapped in
`isVisible()` guards; `isVisible()` does not wait, so it returned `false` against
a still-rendering page, so the test skipped, so CI went green.

The suite carried **229 `test.skip` guards**, **129 non-waiting `isVisible()`
probes** and **27 specs gated on environment variables nobody sets**. Roughly a
third of it was opting out silently while reporting as passing.

The skill instructions were changed in the same commit, so this does not recur.

## Kept (33 specs, 116 tests)

| Group | Specs |
|---|---|
| **1. Auth session lifecycle** | `auth-username-password`, `enhance-auth-route-consolidation`, `enhance-change-password-settings`, `fix-auth-session-expiry-and-register-redirect`, `fix-logout-and-register-sidebar`, `enhance-mock-pki-login`, `enhance-pki-admin-config`, `fix-entra-account-linking`, `fix-entra-admin-recovery`, `phase-entra-login-auth-methods`, `phase-admin-first-login-setup`, `phase-user-roles-permissions` |
| **2. Streaming into the DOM** | `chat`, `chat-typing-and-retry`, `chat-confidence`, `chat-transparency`, `code-quality-hot-paths` |
| **3. File upload / download** | `chat-composer-upload`, `enhance-template-annotation`, `phase-spreadsheet-templates`, `fix-signature-tag-lost-in-annotator`, `fix-template-upload-resets-output-type`, `fix-session-upload-not-reaching-ai`, `phase-narrative-repeating-groups`, `fix-synthesise-live-results`, `enhance-synthesise-summary`, `phase-insights-export-and-summarisation` |
| **4. Navigation state across a page load** | `fix-sticky-link-navigation`, `enhance-site-banner`, `phase-multi-organisation-support` |
| **5. Accessibility** | `accessibility` |
| **6. Smoke** | `smoke`, `fix-zero-env-first-run` |

The kept specs still carry **45 skip guards** and their ticket-shaped names.
Both are follow-up work: the guards must go (a kept spec may not opt out), and
the files should be merged into capability-named specs.

## Removed (88 specs, 264 tests, 184 skip guards)

### The honest caveat

Of the 88, **65 were partly or wholly skip-guarded** — much of what they
asserted was never executing, so removing them costs little beyond the illusion
of coverage.

The other **23 were running clean, with zero skip guards — 51 tests in total.**
Those were doing real work. They are marked **yes** in the table below. Their
behaviour is application, adapter or component logic and belongs one layer down,
but *this triage did not verify that equivalent coverage already exists there*.
Treat that as open work, not as a completed migration. The specs are recoverable
from git history if a gap turns up.

| Spec | Tests | Skip guards | Was running |
|---|---|---|---|
| `admin-dashboards.spec.ts` | 4 | 3 | no |
| `admin-errors.spec.ts` | 2 | 1 | no |
| `admin-flow-editing.spec.ts` | 2 | 0 | **yes** |
| `admin-settings.spec.ts` | 3 | 3 | no |
| `chat-flow-scenarios.spec.ts` | 2 | 4 | no |
| `chats-card-layout.spec.ts` | 1 | 1 | no |
| `enhance-admin-orgs-ui-cleanup.spec.ts` | 3 | 0 | **yes** |
| `enhance-approval-config-and-picker.spec.ts` | 4 | 5 | no |
| `enhance-approval-context.spec.ts` | 3 | 3 | no |
| `enhance-approval-flow-fixes.spec.ts` | 5 | 4 | no |
| `enhance-chat-approval-reassign.spec.ts` | 4 | 3 | no |
| `enhance-chat-approval-withdraw-inline.spec.ts` | 8 | 3 | no |
| `enhance-chat-sidebar-refinements.spec.ts` | 4 | 4 | no |
| `enhance-configurable-embeddings.spec.ts` | 2 | 2 | no |
| `enhance-document-edit-history.spec.ts` | 2 | 4 | no |
| `enhance-document-generation-settings.spec.ts` | 2 | 0 | **yes** |
| `enhance-flow-editor-dedup.spec.ts` | 2 | 1 | no |
| `enhance-flow-insights-approval-segmentation.spec.ts` | 6 | 6 | no |
| `enhance-flow-insights-menu-ui.spec.ts` | 6 | 6 | no |
| `enhance-flow-selector-search.spec.ts` | 6 | 7 | no |
| `enhance-fork-field-consolidation.spec.ts` | 2 | 3 | no |
| `enhance-hr-auto-detect.spec.ts` | 1 | 2 | no |
| `enhance-mcp-internal-external.spec.ts` | 2 | 0 | **yes** |
| `enhance-n8n-workflow-context-mapping.spec.ts` | 2 | 4 | no |
| `enhance-node-config-improvements.spec.ts` | 2 | 4 | no |
| `enhance-node-controls-advanced-section.spec.ts` | 4 | 0 | **yes** |
| `enhance-pre-generation-evaluation.spec.ts` | 2 | 1 | no |
| `enhance-rag-approval-flow-patch.spec.ts` | 6 | 6 | no |
| `enhance-rag-node-config-chat-ui.spec.ts` | 2 | 2 | no |
| `enhance-reindex-documents.spec.ts` | 1 | 1 | no |
| `enhance-repeating-group-editing.spec.ts` | 1 | 0 | **yes** |
| `enhance-settings-connectivity.spec.ts` | 2 | 0 | **yes** |
| `enhance-skill-picker-and-flow-settings.spec.ts` | 2 | 0 | **yes** |
| `enhance-synthesis-flow-ui-fixes.spec.ts` | 9 | 1 | no |
| `enhance-synthesise-enhancements.spec.ts` | 1 | 2 | no |
| `enhance-synthesise-ui.spec.ts` | 1 | 2 | no |
| `enhance-ui-design-refresh.spec.ts` | 5 | 1 | no |
| `enhance-usage-limits-admin-ui.spec.ts` | 2 | 1 | no |
| `enhance-workflow-canvas-onboarding.spec.ts` | 3 | 0 | **yes** |
| `fix-approval-change-request-regeneration.spec.ts` | 2 | 2 | no |
| `fix-better-auth-uuid-id.spec.ts` | 1 | 0 | **yes** |
| `fix-chained-gate-shows-unsent.spec.ts` | 4 | 0 | **yes** |
| `fix-confidence-threshold-scale.spec.ts` | 2 | 0 | **yes** |
| `fix-cross-check-chat-feedback.spec.ts` | 2 | 1 | no |
| `fix-document-generation-context-overflow.spec.ts` | 1 | 1 | no |
| `fix-document-generation-gate-livelock.spec.ts` | 1 | 1 | no |
| `fix-document-generation-step-flow.spec.ts` | 1 | 1 | no |
| `fix-extraction-flows-flag.spec.ts` | 2 | 0 | **yes** |
| `fix-fork-advance-threshold.spec.ts` | 1 | 1 | no |
| `fix-modal-editor-ui-fixes.spec.ts` | 4 | 1 | no |
| `fix-pre-generation-gate-phantom-doc-badge.spec.ts` | 1 | 1 | no |
| `fix-prior-step-fields-stripped.spec.ts` | 1 | 1 | no |
| `fix-sample-run-never-processes.spec.ts` | 3 | 3 | no |
| `fix-scheduler-tick-timestamp-serialization.spec.ts` | 1 | 1 | no |
| `fix-seed-mcp-skills-flags.spec.ts` | 1 | 0 | **yes** |
| `fix-signatures-asked-for-in-chat.spec.ts` | 6 | 0 | **yes** |
| `fix-startup-env-and-db-notices.spec.ts` | 3 | 1 | no |
| `fix-temperature-deprecated-model.spec.ts` | 2 | 2 | no |
| `flow-lifecycle.spec.ts` | 6 | 9 | no |
| `flow-visibility.spec.ts` | 1 | 2 | no |
| `flows.spec.ts` | 5 | 2 | no |
| `node-config-prompt-preview.spec.ts` | 2 | 4 | no |
| `phase-approval-subject.spec.ts` | 5 | 5 | no |
| `phase-audit-compliance-trail.spec.ts` | 5 | 0 | **yes** |
| `phase-container-distribution.spec.ts` | 2 | 0 | **yes** |
| `phase-cost-usage-governance.spec.ts` | 3 | 2 | no |
| `phase-email-notifications.spec.ts` | 2 | 3 | no |
| `phase-extraction-flows-author-sample.spec.ts` | 2 | 3 | no |
| `phase-extraction-flows-batch.spec.ts` | 3 | 3 | no |
| `phase-extraction-flows-outputs.spec.ts` | 4 | 3 | no |
| `phase-flow-skills.spec.ts` | 3 | 0 | **yes** |
| `phase-flow-versioning.spec.ts` | 2 | 2 | no |
| `phase-group-scoped-authorization.spec.ts` | 4 | 2 | no |
| `phase-knowledge-base-curation.spec.ts` | 4 | 2 | no |
| `phase-manual-document-editing.spec.ts` | 2 | 3 | no |
| `phase-mcp-flags-and-transport.spec.ts` | 1 | 0 | **yes** |
| `phase-mcp-flow-consumption.spec.ts` | 2 | 0 | **yes** |
| `phase-mcp-integration.spec.ts` | 3 | 0 | **yes** |
| `phase-rag-with-pgvector.spec.ts` | 2 | 1 | no |
| `phase-schedule-run-logging.spec.ts` | 2 | 2 | no |
| `phase-scheduler-resume.spec.ts` | 2 | 0 | **yes** |
| `phase-scheduling.spec.ts` | 3 | 5 | no |
| `phase-step-approvals.spec.ts` | 6 | 6 | no |
| `phase-step-confirmation-toggle.spec.ts` | 2 | 2 | no |
| `phase-structured-conversation.spec.ts` | 4 | 4 | no |
| `phase-usage-limit-tiers.spec.ts` | 1 | 0 | **yes** |
| `scaling.spec.ts` | 16 | 4 | no |
| `sharing.spec.ts` | 5 | 8 | no |

## Recovering a deleted spec

```
git show <commit-before-this-one>:apps/web/e2e/<name>.spec.ts
```

Before restoring one, check the policy: if it does not fall into one of the six
groups, the right move is to write the equivalent test at the owning layer, not
to bring the spec back.
