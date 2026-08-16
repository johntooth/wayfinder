# When to write a Playwright e2e test

Wayfinder keeps a **small** end-to-end suite. Most behaviour is tested far more
cheaply and far more reliably one layer down, and the architecture in
`CLAUDE.md` exists precisely so that it can be.

An e2e test is the most expensive test we own: it needs Postgres, Redis, MinIO,
a built app and a real browser; it runs sharded in CI and nowhere else; and when
it fails it tells you a page didn't look right, not which unit is wrong.
Reach for one only when nothing cheaper can see the defect.

## The rule

Write a Playwright spec **only** when the behaviour under change falls into one
of these six groups. If it does not, the test belongs at the layer that owns the
logic, and no spec is written.

| # | Group | Why only a browser can see it |
|---|---|---|
| 1 | **Auth session lifecycle** — sign in/out, redirects, session expiry, PKI, Entra, first-run admin setup | Redirect chains and cookie behaviour have no representation below the browser |
| 2 | **Streaming into the DOM** — SSE chat turns, typing indicators, retry | "The server sent it" and "the user saw it" are genuinely different facts here |
| 3 | **File upload and download** — templates, session attachments, exports | The file dialog and the download stream cross the browser boundary |
| 4 | **Navigation state across a page load** — reload, back/forward, sticky links, org switching | State that survives a document load cannot be asserted in-process |
| 5 | **Accessibility** — the rendered a11y tree, keyboard traversal, landmarks | The tree is a browser artefact; it does not exist in jsdom in the same form |
| 6 | **Smoke** — the deployed stack boots and one full flow completes | Proves the wiring, which is exactly what unit tests stub out |

## Where everything else goes

| Behaviour | Test it here |
|---|---|
| Flow logic, approvals, confidence, forking, scheduling rules | `packages/application` |
| Entities, invariants, value objects | `packages/domain` |
| Persistence, AI adapters, storage, e-mail, MCP | `packages/adapters` (integration test against the real service) |
| A component renders the right thing for given props | `apps/web/**/*.test.tsx` (component test) |
| An API route returns the right shape | Route handler test in `apps/web` |

A rule of thumb: if you can describe the bug without saying the word "browser",
it is not an e2e test.

## Non-negotiable rules for specs that do qualify

- **Never guard a test with `test.skip()` on a condition the test itself
  probes.** A test that can opt out will, and it will do so silently. If the
  fixture it needs does not exist, build the fixture or do not write the test.
- **Never use `locator.isVisible()` to decide control flow.** It does not wait —
  its `timeout` option is ignored — so it races client rendering and resolves
  `false` on a page that was merely still loading. Use `expect(...).toBeVisible()`
  or `expect.poll(...)`, which retry.
- **Never gate a spec on an environment variable nobody sets.** The spec will
  never run, and it will report as passing.
- **Name the spec after the capability, not the ticket.** `chat-streaming.spec.ts`,
  not `fix-<slug>.spec.ts`. Extend the existing capability spec instead of adding
  a new file.

## Why these rules exist

They are the direct output of a suite-wide audit (PR #241). The e2e suite had
grown to 121 files and 380 tests because `/build`, `/enhance` and `/bugfix` each
required a new spec per ticket, written without running it. The result was 229
`test.skip` guards, 129 non-waiting `isVisible()` probes and 27 specs gated on
environment variables nobody set — a third of the suite opting out silently
while reporting green. The audit kept the specs covering the six groups above
and demoted the rest to the layer that owns the logic.
