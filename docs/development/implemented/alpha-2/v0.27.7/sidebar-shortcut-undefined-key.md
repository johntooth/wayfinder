# Bug fix — Sidebar ⌘K shortcut crashes on keydown with no `key`

## Symptom

Runtime `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`
at `apps/web/src/components/sidebar-model.ts:88` inside `isNewChatShortcut`.

## Root cause (verified)

`isNewChatShortcut` is wired to a global `keydown` listener in
`apps/web/src/components/sidebar.tsx` (the ⌘K "New chat" shortcut). It calls
`event.key.toLowerCase()` unconditionally. While `KeyboardEvent.key` is a string
per spec, real keydown events dispatched by autofill, password managers, and IME
composition can arrive without a `key`. When that happens `event.key` is
`undefined` and `.toLowerCase()` throws.

The `ShortcutEvent` interface types `key` as a non-optional `string`, which
hides the possibility at the type level and let the assumption ship.

## Reproduction

Dispatch a `keydown` event whose `key` is absent, e.g.:

```js
window.dispatchEvent(new KeyboardEvent("keydown", { metaKey: true }));
// KeyboardEvent normalises key to "", but autofill/IME-origin events deliver undefined
```

Equivalently, calling `isNewChatShortcut({ metaKey: true, ctrlKey: false, target: null })`
with no `key` throws.

## Fix plan

- Widen `ShortcutEvent.key` to `string | undefined` so the type tells the truth.
- Guard early in `isNewChatShortcut`: a falsy `key` returns `false` (not the shortcut).
- Add a regression unit test that passes `key: undefined` and expects `false`.

## Scope

Single defensive change in one function. No schema, data, or API impact.
PATCH bump. Per approval, no Playwright e2e is added for this fix.

## Implementation summary

- **Root cause (verified):** `isNewChatShortcut` called `event.key.toLowerCase()`
  unconditionally, and the global `keydown` listener in `sidebar.tsx` forwards raw
  browser events whose `key` can be `undefined` (autofill / password managers /
  IME composition). A failing test reproduced the exact TypeError.
- **Fix applied:** widened `ShortcutEvent.key` to `string | undefined` and changed
  the guard to `event.key?.toLowerCase() !== "k"`, so a missing key returns `false`
  (not the shortcut) instead of throwing.
- **Regression test added:** `isNewChatShortcut > "ignores a keydown with no key"`
  in `apps/web/src/components/sidebar-model.test.ts` — failed with the TypeError
  before the fix, passes after. Full file: 28 tests green.
- **E2E:** none, per approval note.
- **Version:** PATCH bump `0.27.6` → `0.27.7`.

