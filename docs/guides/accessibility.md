# Accessibility (WCAG 2.2 AA)

Wayfinder's web UI (`apps/web`) targets **WCAG 2.2 Level AA**. This guide
describes how that standard is enforced and what each contributor is responsible
for.

## What is enforced automatically

`apps/web` lints every `.tsx` file with [`eslint-plugin-jsx-a11y`][jsx-a11y] at
its **strict** ruleset. Two config files drive this:

- `apps/web/.eslintrc.cjs` — the general lint config. Layers `jsx-a11y/strict`
  on top of the TypeScript rules, so `pnpm lint` fails on any accessibility
  violation.
- `apps/web/.eslintrc.a11y.cjs` — an accessibility-only config (no TypeScript or
  stylistic rules). Run on its own via `pnpm --filter @wayfinder/web lint:a11y`.

`validate.sh` runs the accessibility-only config as **check 15 (web
accessibility)**, so a11y regressions block CI independently of the general
lint pass. Keep the `jsx-a11y` rule list in the two config files in sync.

The lint layer covers the machine-checkable subset of WCAG 2.2 AA, mapped to the
relevant success criteria:

| Concern | Rule(s) | WCAG SC |
|---|---|---|
| Image alt text | `alt-text`, `img-redundant-alt` | 1.1.1 |
| Form labels | `label-has-associated-control` | 1.3.1, 3.3.2 |
| Group labels | `role="group"`/`aria-labelledby` (manual) | 1.3.1 |
| Headings have content | `heading-has-content` | 1.3.1 |
| Page language | `html-has-lang` | 3.1.1 |
| Keyboard operability | `click-events-have-key-events`, `interactive-supports-focus`, `no-static-element-interactions`, `mouse-events-have-key-events` | 2.1.1 |
| Predictable focus | `no-autofocus`, `tabindex-no-positive`, `no-noninteractive-tabindex` | 2.4.3 |
| Link purpose | `anchor-has-content`, `anchor-is-valid` | 2.4.4 |
| Name, Role, Value | `aria-*`, `role-*` | 4.1.2 |

### Patterns this codebase uses

- **Group labels** — a caption for a set of controls (a radio set, a colour
  swatch row) is not a `<label>`. Use `FieldGroupLabel`
  (`components/ui/field-group-label.tsx`) and associate it with the group via
  `role="group"`/`role="radiogroup"` + `aria-labelledby`.
- **Auto-focus** — the `autoFocus` prop is forbidden (it can move focus
  unexpectedly on load). To focus an element that appears in response to a user
  action, use `useFocusOnMount` (`lib/use-focus-on-mount.ts`), a ref + effect
  gated on the reveal state, or a dialog's `onOpenAutoFocus` handler.
- **Overlays/backdrops** — a click-to-dismiss backdrop is a `<button>`, not a
  `<div onClick>`, so it is keyboard-focusable and activatable.

## What still needs a manual audit

Static linting cannot verify the runtime-only criteria below. Check these by
hand (browser DevTools, keyboard-only navigation, a screen reader) when changing
UI:

- **1.4.3 Contrast (Minimum)** — text contrast ≥ 4.5:1 (≥ 3:1 for large text).
  Colour tokens live in `src/styles/globals.css`.
- **1.4.11 Non-text Contrast** — UI component and graphical boundaries ≥ 3:1.
- **2.4.7 Focus Visible** & **2.4.11/2.4.13 Focus Appearance (2.2)** — every
  interactive element shows a clearly visible focus indicator.
- **2.4.3 Focus Order** — focus moves in a logical order; modals trap focus
  (Radix handles this) and restore it on close.
- **2.5.8 Target Size (Minimum) (2.2)** — interactive targets are ≥ 24×24 CSS px
  (or have sufficient spacing).
- **3.3.7 Redundant Entry** & **3.3.8 Accessible Authentication (2.2)** — don't
  force re-entry of information; don't rely on cognitive function tests for auth.
- **1.4.10 Reflow / 1.4.4 Resize Text** — usable at 320px width and 200% zoom.

[jsx-a11y]: https://github.com/jsx-eslint/eslint-plugin-jsx-a11y
