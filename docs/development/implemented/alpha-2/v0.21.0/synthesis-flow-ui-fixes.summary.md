# Implementation Summary — Synthesis, Flow and Chat UI Fixes (v0.21.0)

- **Version**: 0.21.0 (bump: **MINOR** — new About configuration stored as one
  `admin_system_settings` row; no migration)
- **Base branch**: `release/alpha-2`
- **Phase**: `synthesis-flow-ui-fixes.phase.md` (this folder)
- **E2E**: `apps/web/e2e/enhance-synthesis-flow-ui-fixes.spec.ts`

## What was built

Eighteen reported items, delivered in full.

| # | Item | Where |
|---|---|---|
| 1 | Change organisation from user settings under self-nomination | `settings/organisation-membership-card.tsx`, `organisation/nomination-dialog.tsx`, `routers/organisation.ts` |
| 2 | `/admin/synthesise` gets the admin oversight layout | `(admin)/admin/synthesise/_content.tsx` |
| 3 | New-synthesis modal body padded | `(user)/synthesise/_content.tsx` |
| 4 | Run exceptions explained on the record | `extraction/result-grid-model.ts`, `extraction/result-grid.tsx` |
| 5 | Creating a flow lands on the canvas editor | `(user)/flows/_content.tsx`, `(admin)/admin/flows/_content.tsx` |
| 6 | Configure-step defaults to "generate document" | `canvas/node-config-modal.tsx`, `canvas/node-defaults.ts` |
| 7 | Models that reject `temperature` handled | `ai/sampling-params.ts`, `ai/language-model-adapter.ts` |
| 8 | Markdown rendered in assistant replies | `chat/markdown.ts`, `chat/markdown-text.tsx`, `chat/message-feed.tsx` |
| 9 | Full name no longer defaults to the email | `register-form.tsx`, `create-admin.ts`, `drizzle-user-repository.ts` |
| 10 | Sender name dropped from the chat bubble | `chat/message-feed.tsx` |
| 11 | No progress bar for never-done steps | `routers/session.ts`, `chat/session-card.tsx` |
| 12 | Page header on `/flows` and `/admin/flows` | both `_content.tsx` |
| 13 | Settings moved to the user details block | `sidebar.tsx` |
| 14 | Admin settings sections collapsed by default | `settings/collapsible-section.tsx` |
| 15 | About link configuration | `about-links.ts` (domain), `settings/about-links-card.tsx`, `routers/settings.ts` |
| 16 | Help menu: About modal + configured links | `help-menu.tsx`, `about-modal.tsx` |
| 17 | Time-ago / info icon overlap fixed | `chat/message-feed.tsx` |
| 18 | Approvals count badge in the sidebar | `sidebar.tsx` |

## Notable implementation notes

**Markdown (#8)** is a purpose-built reader rather than a new dependency. It
covers the subset the assistant emits and produces React elements, so no HTML is
ever injected. Headings deliberately render at body size — the request was for
formatting, not for a reply that can resize the conversation. It applies to
assistant and system messages only: a user typing `2*3*4` would otherwise get
italics.

**Temperature (#7)** has two layers, because a static list alone would go stale.
Known-refusing families (Claude 5, OpenAI o-series, GPT-5) never receive the
parameter; an unknown model that refuses it is replayed once without it and
remembered for the rest of the process. Streaming calls are the one gap: the
result object reaches the usage-tracking and tracing decorators the moment it is
created, so replaying it transparently would risk the primary chat path. There
the refusal is recorded as it passes and the next call omits the parameter — the
proactive list already covers every model known to refuse today.

**Follow-up: log genuine AI call failures to `admin_errors`.** `LanguageModelAdapter`
takes an optional `IErrorLogger` (wired in `apps/web`, `apps/api` and the
adapters factory). It logs exactly when a call's `Result` is `err(...)` —
including a temperature refusal that survives the retry above — not when a call
recovers or succeeds. Streaming's mid-stream `onError`/broken-stream path is
deliberately left unlogged there: the `Result` already resolved `ok()`, so it
is not the port reporting a failure, and the primary chat route
(`api/chat/[sessionId]/stream/route.ts`) already logs that same break itself;
logging it again in the adapter would duplicate the row.

**About links (#15/#16)** validate URLs at both boundaries (zod on write,
`parseAboutLinksConfig` on read), accepting only http(s), `mailto:` and
site-relative paths. Icon names are a closed set resolved to components
client-side. `NEXT_PUBLIC_CONTACT_FORM_URL` is gone from `.env.example`.

**Organisation change (#1)** reuses the first-login nomination dialog, as asked.
It is offered only where the configured strategy leaves the choice to the user;
`submitNomination` enforces the same rule server-side, so the card being hidden
is presentation, not the security boundary.

## Collateral changes

- `packages/adapters/src/config/runtime-config-store.ts` was split, with the
  pure defaults and parsers moving to `runtime-config-defaults.ts`. Adding the
  About accessor pushed the file past the repo's 800-line limit; the split
  follows a real seam and re-exports the public names.
- `apps/web/e2e/helpers/settings.ts` was added. Collapsing the admin settings
  sections (#14) hides cards that twelve existing specs interact with, so those
  specs now open the relevant section first.
- Twelve flow specs stopped clicking "Configure Flow" after creating a flow.
  Creating one now lands on the canvas (#5), so the round trip through the list
  was a race — it passed or failed depending on whether the redirect beat the
  click. They wait for the canvas URL instead.
- Two specs that type a completion condition now select "Specific condition"
  first, and set the output type explicitly rather than relying on the default,
  which #6 changed. `#done-when` only renders in condition mode.
- `apps/web/next.config.ts` inlines the repo-root `VERSION` as
  `NEXT_PUBLIC_APP_VERSION` for the About modal.

## Validation

`./validate.sh` — 20 passed, 0 failed.
