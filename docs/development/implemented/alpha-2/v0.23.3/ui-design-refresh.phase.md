# Phase — UI Design Refresh (warm paper system)

- **Status**: Implemented
- **Target version**: 0.23.3  (bump: PATCH — presentation only. No schema
  change, no new step type, no new node, no port or use-case signature changes)
- **Base branch**: `release/alpha-2` (stabilisation only — see CLAUDE.md
  *Release Branching*). This changes how existing surfaces look, it does not add
  a surface, so it is an enhancement rather than a feature.
- **Design source of truth**: `docs/development/storybook/index.html` as updated
  by commit `194fadf` ("Updated storybook for a new UI"), plus a chat mockup
  supplied by the product owner that matches those tokens exactly.
- **Depends on**: nothing outside `apps/web`. `packages/domain`,
  `packages/application` and `packages/adapters` are untouched.

## 1. Problem

The Storybook was rewritten to a new visual system — a warm "paper" neutral
ramp, a new accent, Figtree/JetBrains Mono, and a restructured shell. The
application still renders the previous system: DM Sans/DM Mono, a cooler grey
ramp, `#3a5fd9` accent, a white sidebar panel, and a chat screen whose header
and step rail occupy two separate horizontal bands.

The gap is not cosmetic drift that will settle on its own. Three specific
structural decisions in the new Storybook have no counterpart in the app:

1. **The shell is inverted.** Today the sidebar is a white panel on a warm
   canvas. The new system makes the sidebar the *tinted* surface (`--bg2`,
   separated by a single hairline, no shadow) and the canvas the light one. The
   only white surface left in the rail is the active recent-chat card.
2. **Two bands become one.** `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`
   renders a 52px `<header>` and then `StepProgressRail` as a second full-width
   band, costing ~100px of vertical space before any conversation appears. The
   Storybook folds the rail into the header as a second line.
3. **The help control is homeless.** `HelpMenu` is positioned
   `fixed right-3 top-3`, floating over whatever page content sits underneath
   it. It belongs in the rail beside the `ALPHA` badge.

Alongside those, the palette itself is hardcoded: roughly 1,430 hex literals
across ~130 components in `apps/web/src`, 122 of them the old accent. Nothing
reads a token, so nothing follows the Storybook automatically.

## 2. Root cause

There is no token layer between the design system and the components.

`apps/web/src/styles/globals.css` *does* define the Storybook tokens
(`--bg`, `--surface`, `--wf-primary`, …) but almost nothing consumes them.
Components were written with literal Tailwind arbitrary values —
`bg-[#f7f6f3]`, `text-[#6d6a65]`, `border-[#dedad2]` — so a Storybook change
cannot propagate. `tailwind.config.ts` exposes only the shadcn HSL aliases
(`background`, `primary`, `muted`), which the Wayfinder-specific chrome does
not use.

That is why the refresh has to be two distinct pieces of work: a mechanical
re-mapping to carry every screen onto the new palette, and a hand-built
restructure of the surfaces whose *layout* changed.

## 3. Scope decisions (confirmed with the product owner)

| Question | Decision |
|---|---|
| How far does the refresh reach? | Tokens and fonts change **globally** — every screen including admin, flow canvas, synthesise, settings and auth picks up the new palette. Structural rework is limited to the surfaces the Storybook actually specifies (shell, header, chat, cards, modals). Admin dashboards and the flow canvas keep their present layout. |
| Sidebar footer | Matches the mockup: `Enter admin mode` + user chip only. Settings, Usage and Sign out move into a popover opened from the chip. |
| Nav marks | 6px dots for the four-item user rail (per Storybook). The ~20-item admin rail keeps lucide icons — twenty identical dots are not scannable. Groups and collapse behaviour unchanged. |
| Type scale | One step **below** the Storybook/mockup values. The owner asked for smaller text and tighter elements in the rail, and slightly smaller body text, to fit more content per screen. §4.2 fixes the scale. |
| Release target | `release/alpha-2`, PATCH. |

## 4. Design

### 4.1 Token layer

`globals.css` gains the Storybook ramp as the single source of colour:

```
--bg #faf9f7   --bg2 #f5f3ee   --bg3 #ebe8e0   --surface #ffffff
--border #e7e3db   --border-strong #dedad2   --border-dashed #d8d3c7
--text #1c1b19   --text2 #5c574c   --text3 …   --text4 …
--primary #2f56d3   --primary-light #eaeefb   --primary-dim #c3cef2
```

with the semantic pairs (success / warning / rose / teal / purple), the three
elevation shadows, and the 7/9/14/18px radius scale.

The shadcn HSL aliases (`--background`, `--primary`, `--border`, `--ring`, …)
are re-derived from the same values so `bg-background` and `text-primary`
consumers shift with everything else rather than becoming a second palette.

`tailwind.config.ts` exposes the ramp as a named `wf.*` scale, so components
written after this phase reference `bg-wf-rail` rather than another hex
literal. The existing literals are re-mapped rather than rewritten to classes
(§5.2) — converting 1,430 call sites to utility names would balloon the diff
without changing a pixel.

#### Contrast constraint (deviation from the mockup, deliberate)

The mockup's two lightest text tokens do not meet WCAG 1.4.3 AA on white:

| Token | Mockup value | Contrast on `#ffffff` | AA (4.5:1) |
|---|---|---|---|
| `--text3` | `#8a8272` | 3.81:1 | fails |
| `--text4` | `#a09884` | 3.02:1 | fails |

This is not a new consideration. `globals.css` carries comments recording that
these exact values were previously *darkened for this reason* (`--text3` was
moved from `#918d87` to `#6d6a65`), and `apps/web/e2e/accessibility.spec.ts`
enforces the outcome at runtime — it drives axe-core with the `wcag2aa` tag, so
1.4.3 Contrast (Minimum) is checked against *rendered* colour values on every
listed page. (The static `eslint.config.a11y.js` layer, `validate.sh` check 15,
cannot see colour at all; it is the jsx-a11y ruleset only.) Adopting the mockup
literals would knowingly re-open a closed defect and turn that suite red.

Resolution: ship hue-matched darkened variants that clear 4.5:1 and preserve
the ramp's ordering. Exact values are computed during implementation from the
WCAG relative-luminance formula rather than picked by eye, and asserted by a
unit test so a later edit cannot quietly regress them:

- `--text3` ≈ `#6f6857` (~5.4:1) — secondary body copy, metadata
- `--text4` ≈ `#7c7463` (~4.6:1) — eyebrows, timestamps, placeholder text

The literal mockup values remain available as `--rule` / `--dot` for
**non-text decoration only** (hairlines, nav dots, dividers), where 1.4.3 does
not apply and 1.4.11 (3:1 for meaningful non-text) is met.

### 4.2 Type scale

Storybook values in the left column, shipped values in the right. The
reduction is uniform enough to stay proportional but is applied per role
rather than by a blanket multiplier, so nothing crosses below 10.5px.

| Role | Storybook | Shipped |
|---|---|---|
| Rail wordmark | 16px | 15px |
| Rail nav item | 14px | 13px |
| New chat button | 13.5px | 13px |
| Recent chat title | 13px | 12.5px |
| Recent chat meta | 11px | 10.5px |
| Rail section label (mono eyebrow) | 10px | 10px (floor) |
| Header page title | 18px | 16.5px |
| Header breadcrumb | 13px | 12.5px |
| Step rail label | 12px | 11.5px |
| Chat body copy | 15px | 14px |
| Chat event row | 14px | 13px |
| Composer input | 15px | 14px |
| Composer caption | 11px | 10.5px |

Vertical rhythm tightens with it: rail nav items `8px → 6.5px` vertical
padding, recent-chat cards `9px → 7.5px`, chat message gap `26px → 20px`.

### 4.3 Shell — sidebar

`components/sidebar.tsx` is rebuilt, not restyled:

- Rail fills `--bg2`, 220px → 246px, single right hairline, no shadow
- Brand row: `W` mark, wordmark, `ALPHA` badge, and — right-aligned — the
  relocated help control (§4.4)
- A bordered **New chat** button directly under the brand row carrying a `⌘K`
  hint. The hint is wired to a real handler that opens the existing
  `NewChatModal`; rendering an inert shortcut pill would be a lie to the user
- User nav items get a 6px dot; the dot fills `--primary` when active. Admin
  nav keeps its lucide icons. `NavGroups` takes a `mark` prop rather than
  forking into two components
- Recent chats become two-line cards — title, then `status · relative time`.
  The active card is the rail's only white surface
- Footer: `Enter admin mode` / `Exit admin mode`, then the user chip. The chip
  is a popover trigger exposing **Settings**, **Usage** and **Sign out**, and
  carries the ring usage meter (§4.4a) inline to the right of the user's name

### 4.4a Usage meter — ring variant

`components/usage-meter.tsx` gains a second rendering. The existing horizontal
bar is kept for the placements that have width for it (the chip popover, and
any future settings surface); a new compact **ring** sits in the footer chip,
to the right of the user's name and email.

- ~18px circular SVG: a `--bg3` track with an arc sweeping clockwise from 12
  o'clock in proportion to the most-constrained period's ratio
- Arc colour follows the existing `ok` / `warn` / `blocked` status mapping,
  re-pointed at the new palette rather than the current hardcoded trio
- The component's existing early return is unchanged — when the usage master
  switch is off, or no limit resolves for the user, **nothing renders** and the
  chip lays out as if the meter were not there. This is the "when that is
  turned on" condition, and it already exists; the ring inherits it
- Hover and keyboard focus reveal the same per-period breakdown the bar shows
  today (spend, limit, remaining, reset date)
- `role="progressbar"` with `aria-label`, `aria-valuenow`/`min`/`max` carries
  over unchanged, so the ring is not a screen-reader regression. The arc is
  checked against the track for 1.4.11 non-text contrast (≥3:1)

Because the ring is small and sits inside an interactive chip, the breakdown
must also be reachable without hover — the chip popover lists it, which is why
the bar rendering is retained rather than replaced.

### 4.4 Help control relocation

`components/help-menu.tsx` loses its `fixed` positioning and its white pill.
It renders inline in the rail's brand row, styled to sit beside `ALPHA`:
hairline border, `--text3`, transparent fill. Its menu (About + admin-curated
about-links) is unchanged in content; it opens anchored to the rail instead of
the viewport corner.

Both `app/(user)/layout.tsx` and `app/(admin)/admin/layout.tsx` stop rendering
it as a floating sibling.

`aria-label="Help"` and the `aria-haspopup`/`aria-expanded` pair are preserved,
so `accessibility.spec.ts` and any test locating the control by role keep
working.

### 4.5 Shell — two-line app header

A new `components/layout/app-header.tsx` implements the Storybook pattern:

- **Line 1** — optional breadcrumb (`label` + `/`), title, optional status
  pill, right-aligned action slot
- **Line 2** — optional inline step rail; omitted entirely on pages without
  steps, which then render as a single-line header

Adopted by: chat session, chats list, flows list, flow config header,
approvals list and detail, synthesise, knowledge, settings. Each of those
currently hand-rolls its own header bar; they converge on one component.

`components/chat/step-progress-rail.tsx` grows an `inline` variant for line 2.
The existing vertical variant is retained — it is used where horizontal space
is short — so this is an addition to the component, not a replacement.

### 4.6 Chat surface

- `message-feed.tsx` — step-boundary dividers (hairline / mono eyebrow /
  hairline), right-aligned user bubbles on `--bg3` with the asymmetric
  `14px 14px 4px 14px` radius, a `W` mark on agent turns, and restyled event
  rows for approved / changes-requested / rejected / system
- `chat-composer.tsx` — 14px rounded card on `--surface`, attach affordance
  left, primary send button right, helper caption beneath
- `session-card.tsx`, `document-card.tsx`, `milestone-pill.tsx`,
  `confidence-bar.tsx`, `typing-indicator.tsx`, `empty-state/`, and the
  loading skeletons follow their Storybook stories
- `ui/` primitives (`button`, `badge`, `card`, `dialog`, `input`, `textarea`)
  adopt the new variants and radii. Their prop APIs do not change, so the ~130
  call sites do not move

### 4.7 Auth and setup screens

These are restructured to the new system rather than left to inherit the
palette, because they are the first screens a new user ever sees and they
currently carry none of the shell's chrome.

- `app/(auth)/layout.tsx` — the centring shell moves onto `--bg`, with the
  brand mark and wordmark above the card so an unauthenticated page is
  identifiably Wayfinder
- `app/(auth)/login/page.tsx` and `app/(auth)/register/register-form.tsx` —
  card adopts `--surface`, `--radius-lg`, the `--sh` elevation and the §4.2
  type scale; inputs and buttons pick up the refreshed `ui/` primitives; the
  auth-method choices (password, Entra, PKI) render as the Storybook's
  secondary buttons rather than ad-hoc styling
- `app/setup/page.tsx` and `components/onboarding/*` — the wizard's step
  indicator adopts the same step-badge vocabulary as the chat step rail
  (complete `✓` / current numbered / pending), so "where am I in a sequence"
  looks the same everywhere in the product. `wizard-requirement.tsx` status
  rows move onto the semantic success/warning/rose pairs
- `wizard-requirements.ts` and its test are pure logic and are not touched

### 4.8 Mobile

Responsiveness is preserved, and the breakpoint moves to match the Storybook's
stated `≤640px` (from the current `md`, 768px) — a 700px tablet comfortably
fits a 246px rail plus content, so the drawer should not claim it.

- Rail becomes a full-height overlay drawer from the left, keeping its `--bg2`
  fill, over a `rgba(28,27,25,.32)` backdrop
- Mobile header row: hamburger, title, status pill. Line-1 actions collapse
  into the existing `•••` menu
- The inline step rail scrolls horizontally with the scrollbar hidden, as the
  current rail already does
- The composer keeps its full-width behaviour; the helper caption is retained

## 5. Implementation plan

Ordered so that each step leaves the app in a working state.

### 5.1 Foundation

1. `app/layout.tsx` — `Figtree` (400/500/600/700) and `JetBrains_Mono`
   (400/500) via `next/font/google`, exposed as `--font-figtree` /
   `--font-jetbrains-mono`
2. `globals.css` — new ramp, re-derived shadcn HSL aliases, radius scale, with
   the contrast rationale recorded in a comment as the current file does
3. `tailwind.config.ts` — font vars and the `wf.*` colour scale

### 5.2 Palette re-mapping

A single old→new mapping applied across `apps/web/src`, then a manual pass over
whatever the mapping does not cover:

```
#3a5fd9 → #2f56d3    #f7f6f3 → #faf9f7    #efede8 → #f5f3ee
#dedad2 → #e7e3db    #1a1814 → #1c1b19    #5a5650 → #5c574c
#eef1fc → #eaeefb    #e6e3dc → #ebe8e0    #c5d0f7 → #c3cef2
```

plus the semantic pairs and the two muted-text tokens (to the §4.1 values, not
the mockup literals). The mapping is applied as a scripted edit because 1,430
hand edits invite transcription errors; the result is reviewed file by file for
cases where a literal was doing something other than what its name suggests.

### 5.3 Structural work

In order: sidebar → help relocation → `AppHeader` + inline step rail → header
adoption per page → chat surface → `ui/` primitives → mobile.

Each sub-component gets its test written first, and `./validate.sh` runs after
each before moving on.

## 6. Tests

### 6.1 Unit (Vitest)

- **Sidebar** — help control renders inside the rail, not as a fixed-position
  sibling; user nav renders dots and admin nav renders icons; the chip popover
  exposes Settings, Usage and Sign out; `⌘K` opens the new-chat modal and does
  not fire while a text input holds focus
- **AppHeader** — renders breadcrumb / title / status / actions; omits line 2
  when no steps are supplied; renders the inline rail when they are
- **Tokens** — the shipped `--text3` and `--text4` values compute to ≥4.5:1
  against `--surface` under the WCAG relative-luminance formula. This is the
  guard that stops a future edit re-adopting the mockup literals
- **UsageMeter** — the ring renders nothing when usage is disabled or no limit
  resolves; the arc length tracks the most-constrained period, not the first;
  status thresholds still select the right arc colour

### 6.2 End-to-end (Playwright)

`apps/web/e2e/enhance-ui-design-refresh.spec.ts`, covering the user-visible
behaviour this phase introduces:

1. The help control resolves **inside the sidebar**, and opening it still
   reaches About
2. A chat session renders title and step rail within a single header block —
   asserting the two-band layout is gone
3. The user chip popover exposes Sign out (the interaction that moved)
4. At a 390px viewport the rail is hidden, the hamburger opens the drawer, and
   a nav item is reachable
5. The login screen renders the brand mark above the card and signs a user in —
   proving the auth restructure did not break the form

`accessibility.spec.ts` runs under the authenticated `chromium` project, so its
`PAGES` list reaches only signed-in surfaces (admin flows/roles/users/settings,
user settings, approvals) plus the flow editor. `/login` is therefore *not*
covered today, and this phase restructures it. The new spec adds an
unauthenticated axe run against `/login` with the same `wcag2a`/`wcag2aa`/
`wcag21a`/`wcag21aa`/`wcag22aa` tag set, closing that gap rather than assuming
it was already closed.

Written but **not run locally** — `.github/workflows/e2e.yml` runs the suite on
the pull request against a full stack.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A scripted hex re-map changes a literal that was not part of the palette (a chart series colour, a syntax-highlight token) | The mapping keys only on the ten known palette values; every touched file is reviewed in the diff |
| Tests locating elements by colour or by the old fixed-position help button break | Expected and intended; those assertions are updated as part of the phase rather than worked around |
| The header consolidation changes scroll height and breaks a Playwright viewport assumption | The e2e suite runs on the PR; §6.2 case 2 asserts the new structure directly |
| Type scale reduced below comfortable reading | Nothing drops below 10.5px, and the reduction is paired with the *darkened* muted tokens, so effective legibility at the smaller sizes is better than the mockup's |
| The ring meter is too small to read, or its arc fails 1.4.11 non-text contrast | The ring is a summary, not the data — the exact figures stay in the chip popover and in hover/focus. The arc/track pair is contrast-checked as part of §4.4a |
| Restructuring the auth screens breaks sign-in, the one flow with no fallback | e2e case 5 signs a user in through the rebuilt form; the existing `auth-username-password.spec.ts` and `enhance-mock-pki-login.spec.ts` suites also exercise it on the PR |

## 8. Out of scope

- Restructuring admin dashboards, the flow canvas, or synthesise screens.
  They receive the palette and type change only
- Converting the 1,430 re-mapped literals to Tailwind token classes
- Dark mode. Wayfinder remains light-only; `color-scheme: light` stays pinned
- Any change to `packages/*`
