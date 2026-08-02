# Phase — Synthesis, Flow and Chat UI Fixes (v0.21.0)

- **Version**: 0.21.0 (bump: **MINOR** — new About configuration; no DB migration)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance` + `/bugfix` batch

## Why

A round of operator feedback across the chat, flows, synthesise and admin
surfaces. Most items are small corrections to layout, defaults and navigation;
three are substantive:

1. The assistant answers in markdown, which reached the browser as literal
   asterisks.
2. The Claude 5 family rejects `temperature`, failing every call on the
   configured default model.
3. There was no way for an operator to point users at their own support
   channels — the help menu was hard-coded.

## What changes

### Chat

- **Markdown in assistant replies.** A purpose-built reader (`markdown.ts`)
  turns the subset the assistant actually emits — emphasis, code, links,
  bullets, headings — into a node tree, which `markdown-text.tsx` renders as
  React elements. Nothing is injected as HTML. Headings render at body size:
  a reply must never scale the conversation's type up. Applied to assistant and
  system messages only, so a user typing `2*3*4` still sees `2*3*4`.
- **Sender name** removed from the bubble; the initials avatar beside it already
  identifies the sender and carries the full name as its tooltip.
- **Time-ago / info icon overlap** on a never-done node, where no confidence bar
  sits between the timestamp and the absolutely-positioned info button.
- **Never-done steps** in the chat list keep "Step X/Y" and the status badge but
  lose the progress bar and percentage — there is no completion to measure.
  `buildSessionListEntry` gains `currentStepNeverDone`, derived from the flow's
  node configs.

### AI

- **Unsupported sampling parameters.** `sampling-params.ts` holds two defences:
  a list of model families known to refuse `temperature` (Claude 5, OpenAI
  o-series and GPT-5), so the common case never pays for a failed round trip;
  and a runtime detector that recognises the refusal, letting the adapter replay
  the call once without the parameter and remember the answer. The second is
  what keeps a model released after this code was written working. Streaming
  calls cannot be replayed transparently — the result object reaches the
  usage-tracking and tracing decorators as soon as it is created — so there the
  refusal is recorded as it goes past and the next call omits the parameter.
- **Genuine AI call failures logged to `admin_errors`.** `LanguageModelAdapter`
  takes an optional `IErrorLogger`. It fires exactly when `generateObject`,
  `generateText`, `streamText` or `streamObject` return `err(...)` — including a
  temperature refusal that survives the retry — with the provider, model and
  cause in the row. A call that recovers, or a mid-stream break after the
  `Result` already resolved `ok()`, is not logged: the primary chat route logs
  a broken stream itself, so logging it again in the adapter would duplicate
  the row.

### Flows and canvas

- **Page header** on `/flows` and `/admin/flows`, matching `/chats`.
- **Creating a flow** goes straight to the canvas editor. A new flow is empty,
  so returning to the list left the author a click away from anything useful.
- **Default output type** for a conversational step is now "generate document",
  with the matching `__TEMPLATE_COMPLETE__` completion condition — the pair
  selecting it by hand already produces.

### Synthesise

- **`/admin/synthesise`** takes the admin oversight layout ("All Syntheses",
  wide container) rather than a copy of the operator workspace.
- **New-synthesis modal** body wrapped in `DialogBody`, which it was missing.
- **Run exceptions** are explained. The "Exception" badge said a record needed
  triage but not why; `recordExceptionReasons` derives the reasons (nothing
  extracted, an unreadable source, a source that produced no record) and the
  expanded record lists them.

### Navigation and settings

- **Settings** leaves the sidebar nav; the user details block in the bottom left
  navigates there instead.
- **Approvals** gains a count of items awaiting the user, sharing its query
  cache with `/approvals`.
- **Organisation change** from user settings, but only where the configured
  resolution strategy leaves the choice to the user (self-nomination, or an
  email-domain miss set to nominate). The existing nomination dialog is
  extracted and reused; a new `organisation.nominationOptions` query answers for
  a user who already has an organisation, which `signInState` does not.
- **Full name** no longer defaults to the account's email address. Sign-up stops
  substituting it, and a blank stored name reads as null.

### About and help

- **About configuration** at the bottom of General in `/admin/settings`: a list
  of entries, each with link text, URL, icon and a "show in help menu" flag.
  Stored as one JSON row (`about_links_config`), so no migration. A default
  "Report an issue" entry ships pointing at the project tracker, off the help
  menu.
- **Help menu** offers About plus the entries flagged for it. The About modal
  carries the app name, version (inlined from the repo-root `VERSION`) and a
  description, with the configured links as buttons along the bottom.
- **Contact developers** removed, along with `NEXT_PUBLIC_CONTACT_FORM_URL`.
- **Admin configuration sections** start collapsed, and their headers are styled
  as obvious controls (hover state, Show/Hide, boxed chevron).

## Non-obvious decisions

- **URL validation** for About links mirrors the site-banner rule: http(s),
  `mailto:` and site-relative paths only. The value becomes an `href`, so
  `javascript:`, `data:` and protocol-relative `//host` are rejected at both the
  write boundary (zod) and the read boundary (`parseAboutLinksConfig`).
- **Icon names** are a closed set, because the name crosses the wire and is
  resolved to a component client-side.
- **`runtime-config-store.ts` was split.** Adding the About accessor pushed it
  past the repo's 800-line limit; the pure defaults and parsers moved to
  `runtime-config-defaults.ts`, which is a real seam — they have no knowledge of
  caching or the settings repository. Public names are re-exported so existing
  importers are unaffected.

## Test coverage

Unit: `markdown.test.ts` (22), `about-links.test.ts` (17),
`sampling-params.test.ts` (14), plus additions to
`language-model-adapter.test.ts`, `session.test.ts`,
`result-grid-model.test.ts` and `drizzle-user-repository.test.ts`.

E2E: `enhance-synthesis-flow-ui-fixes.spec.ts`.

Collapsing the admin settings sections hides cards a number of existing specs
interact with, so `e2e/helpers/settings.ts` was added and those specs now open
the relevant section first.
