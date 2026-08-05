# Implementation Summary — UI Design Refresh (warm paper system)

- **Version**: 0.23.3 (PATCH — presentation only; no schema change, no port or
  use-case signature change, no `packages/*` change)
- **Base branch**: `release/alpha-2`
- **Phase doc**: [`ui-design-refresh.phase.md`](./ui-design-refresh.phase.md)

## What shipped

### Token layer

`apps/web/src/styles/globals.css` now carries the Storybook's warm paper ramp as
the single source of colour, with the shadcn HSL aliases re-derived from the same
values so `bg-background` / `text-primary` consumers move with it rather than
becoming a second palette. `tailwind.config.ts` exposes the ramp as a named
`wf.*` scale plus `rounded-wf-*` / `shadow-wf-*` so chrome written after this
change references a token instead of another hex literal.

`apps/web/src/lib/design-tokens.ts` is a TypeScript mirror of the ramp. It exists
so the palette can be asserted — see the contrast note below.

Fonts moved from DM Sans / DM Mono to **Figtree / JetBrains Mono**.

### Contrast — a deliberate deviation from the mockup

The design mockup specifies `--text3: #8a8272` and `--text4: #a09884`. Measured
against the surfaces they actually sit on, both fail WCAG 1.4.3 AA:

| Token | Mockup | on `#ffffff` | on rail `#f5f3ee` |
|---|---|---|---|
| `--text3` | `#8a8272` | 3.81:1 | 3.43:1 |
| `--text4` | `#a09884` | 2.87:1 | 2.59:1 |

`globals.css` already recorded that these values had been darkened once before
for exactly this reason, and `accessibility.spec.ts` drives axe-core with the
`wcag2aa` tag, so adopting them would have re-opened a closed defect and turned
that suite red.

Shipped instead are hue-matched darkenings, solved numerically against the
**rail** fill rather than white — muted text appears on the rail, which is the
worst case, and solving against white alone left `--text4` at 4.12:1 there:

| Token | Shipped | on `#ffffff` | on rail `#f5f3ee` |
|---|---|---|---|
| `--text2` | `#5c574c` | 7.19:1 | 6.48:1 |
| `--text3` | `#666055` | 6.23:1 | 5.62:1 |
| `--text4` | `#736d5f` | 5.14:1 | 4.64:1 |

The mockup's lightness survives on `--rule` and `--dot`, which carry no text.
`src/lib/design-tokens.test.ts` asserts the ramp stays monotonic and above 4.5:1
on every surface muted text is allowed on, and explicitly asserts that the two
raw mockup values fail — so a later "match the mockup exactly" edit trips a test
that explains why it must not.

### Type scale

Set one step below the Storybook throughout, at the product owner's request, to
fit more content per screen: rail items 13px, recent-chat titles 12.5px, meta
10.5px (floor), header titles 16.5px, chat body 14px, step labels 11.5px.
Vertical rhythm tightened alongside it (rail items 8 → 6.5px padding, chat
message gap 26 → 20px).

### Shell

- **Sidebar** rebuilt: tinted `--bg2` rail at 246px behind a single hairline (no
  white panel, no shadow); bordered **New chat** button with a `⌘K` hint bound to
  a real handler that opens the existing `NewChatModal`; 6px dots for the
  four-item user nav, lucide icons retained for the ~20-item admin nav; recent
  chats as two-line cards with the active one the rail's only white surface.
- **Sidebar footer** matches the mockup: admin-mode toggle plus user chip. The
  chip is a popover trigger carrying **Settings**, **Usage** and **Sign out**.
- **Help control** left its `fixed right-3 top-3` position for the rail's brand
  row, weighted to match the `ALPHA` badge beside it. Removed as a floating
  sibling from both the user and admin layouts; ARIA preserved.
- **Two-line app header** (`components/layout/app-header.tsx`) replaces the
  separate 52px header and step-rail band, reclaiming roughly 50px of
  conversation space. Adopted by the chat session, chats, flows, approvals and
  synthesise screens.
- **Usage meter** gained a compact ring (`UsageRing`) in the footer chip, right
  of the user's name, per the Claude Code style reference. The bar rendering is
  retained for the chip popover so the figures stay reachable without hovering an
  18px target. ADR-031's "nothing renders unless a limit resolves" behaviour and
  its most-restrictive-period rule are unchanged and now unit-tested.

### Chat surface

Step-boundary dividers (hairline / mono eyebrow / hairline), right-aligned user
bubbles on `--bg3` with the asymmetric radius, and a `W` mark on agent turns.
Agent replies are plain text rather than a card, per both the Storybook and the
mockup; the confidence bar and info affordance moved to an inline meta row.
Composer rebuilt as a 14px rounded card with attach, primary send and caption.

### Auth and setup

`(auth)/layout.tsx` puts the brand mark above the card so a signed-out screen is
identifiably Wayfinder. The setup wizard gained a step rail using the same badge
vocabulary as the chat rail, so "where am I in a sequence" reads identically
across the product.

### Mobile

The drawer breakpoint moved from `md` (768px) to the Storybook's **640px**, so
tablets keep the rail. Drawer keeps the `--bg2` fill over a
`rgba(28,27,25,.32)` backdrop.

### Palette re-map

1,275 hex literals across 126 files were carried onto the new ramp by a scripted
mapping keyed only on the ten known palette values, then reviewed in the diff.
This is what moves admin, the flow canvas, synthesise, settings and auth onto the
new palette without restructuring them.

## Tests

**Unit (Vitest)** — 685 passing, including three new suites:

- `src/lib/design-tokens.test.ts` — the contrast guard described above
- `src/components/sidebar-model.test.ts` — recent-chat age formatting and the
  `⌘K` binding, including that it does not fire while a text field has focus
- `src/components/usage-ring-model.test.ts` — ring geometry (including clamping
  a period whose spend exceeded its limit, which would otherwise wind the arc
  past a full circle) and the most-restrictive-period rule
- `src/components/layout/app-header-model.test.ts` — single-line vs two-line
  header, and step state resolution

**End-to-end** — `apps/web/e2e/enhance-ui-design-refresh.spec.ts` covers the
behaviour that moved:

1. The help control resolves **inside** the sidebar, and still reaches About
2. The chat header contains both the title and the inline step rail, and the old
   standalone band is gone (`step-rail-band` count is 0)
3. Sign out and Settings are reachable from the account menu — asserted, not
   clicked, since signing out would invalidate the shared `storageState`
4. At 390px the rail is hidden, the hamburger opens the drawer, and it closes
5. An unauthenticated axe run against `/login`. The existing
   `accessibility.spec.ts` runs under the authenticated project, so `/login` was
   never covered — this closes that gap rather than assuming it was closed

Deliberately **not** asserted: hex values or font families. Pinning those in e2e
would make every future design tweak a test failure, and contrast is already
covered numerically by the unit test and at runtime by axe.

The e2e suite was not run locally — it needs Postgres, Redis, MinIO and a built
app. `.github/workflows/e2e.yml` runs it sharded on the pull request.

## Validation

`./validate.sh` — 21 passed, 0 failed. jsx-a11y strict clean; coverage thresholds
met; `VERSION` and root `package.json` both at 0.23.3.

## Notes for the next person

- `--bg3` is deliberately excluded from `MUTED_TEXT_SURFACES`. It is the
  pressed/bubble fill and carries only `--text` or `--text2`; including it
  squeezes the four-step ramp into a 0.7:1 spread and the ramp stops reading as
  a ramp. If a future surface needs muted text on `--bg3`, the ramp has to be
  re-solved rather than the constraint relaxed.
- The scripted re-map preserved the casing of the literal it replaced, which
  mis-fired on digit-only hexes (`#777570` is trivially "uppercase"). One
  artefact reached the tree and was normalised; if the mapping is ever re-run,
  fix the casing test first.
