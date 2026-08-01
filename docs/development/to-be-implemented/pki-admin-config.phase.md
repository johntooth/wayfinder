# Phase — PKI under the admin Authentication card

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 0.22.0 — **MINOR** (new config surface + UI; no DDL)
- **Base branch**: `release/alpha-2` — chosen by the maintainer. See §9 for the
  risk this carries; `/doc-review` should weigh it rather than assume it.
- **PRD**: `docs/development/prd/pki-admin-config.prd.md`
- **ADR**: supersedes ADR-025 §5 ("PKI stays as-is"). Needs ADR-042 — see §7.
- **Depends on**:
  - **PR #209** — `/api/auth/cert` must answer `GET` before the login-page
    button can work. It is a plain navigation, not a form post. Do not start
    until #209 is on `release/alpha-2`.
  - ADR-025 (runtime auth config, `RuntimeConfigStore`, `enabledAuthMethods`)
  - ADR-041 (first-run wizard, DB-first config)

## 1. Goal

Let an admin turn PKI / client-certificate sign-in on and off from
`/admin/settings` → Authentication and from the first-run setup wizard, the same
way Entra ID already works — **without** moving the trust anchor out of the
environment.

Today PKI is the only method configured purely by environment. `AUTH_METHOD`
decides three separate things at boot (whether the adapter is built, whether the
route answers, where `middleware.ts` sends unauthenticated requests), so an
operator cannot enable it without a redeploy, and a mixed PKI + password
deployment cannot present both options.

## 2. The split: what moves to the DB, what does not

| Value | Home | Why |
| ----- | ---- | --- |
| `pkiEnabled` | DB (`auth_config`) | An operator switch, like `entraEnabled`. |
| `pki.sessionTtlHours` | DB (`auth_config`) | A preference with no security boundary. |
| `PKI_TRUSTED_PROXY_IPS` | **env, unchanged** | The trust anchor. |

**`PKI_TRUSTED_PROXY_IPS` deliberately stays in the environment.** The whole PKI
trust model is "these headers are believed only from these IPs". Move that list
into the admin UI and a compromised admin account can add an attacker-controlled
IP, then forge `x-ssl-client-*` from it and sign in as anyone — a privilege
escalation that does not exist today. Entra's client secret is safe in the DB
because leaking it does not grant impersonation; the proxy list is a different
class of value.

So the env var becomes the **precondition** and the DB row becomes the
**switch** — which is exactly what the greyed-out UI in §3 expresses.

## 3. UI behaviour (the requirement driving this phase)

`AuthMethodsCard` is rendered by both `/admin/settings` and the first-run wizard
(`setup-wizard.tsx:193`), so one component change covers both surfaces. Do not
fork it.

The PKI row is **always listed**, in both surfaces, in all three states:

| Env state | DB state | Row renders as |
| --------- | -------- | -------------- |
| `PKI_TRUSTED_PROXY_IPS` unset | — | Listed, checkbox **disabled**, subtext: *"Requires `PKI_TRUSTED_PROXY_IPS` to be set in the environment before this can be enabled."* |
| set | `pkiEnabled: false` | Listed, checkbox enabled, unchecked |
| set | `pkiEnabled: true` | Listed, checked; summary shows session TTL |

Never hide the row. An operator who cannot see the option cannot discover what
to set — the greyed-out state with the variable named in the subtext *is* the
documentation.

The disabled state must be enforced server-side too, not only in the checkbox:
`setAuthConfig` rejects `pkiEnabled: true` when the env gate is unsatisfied. A
disabled input is a UI affordance, not an authorisation check.

## 4. What is built

| Layer | File | Change |
| ----- | ---- | ------ |
| domain | `entities/runtime-config.ts` | `AuthConfig` gains `pkiEnabled: boolean` and `pki: { sessionTtlHours: number }`. Add `isPkiUsable(config, envHasTrustedProxies)`. Extend `isAtLeastOneMethodEnabled` — see §5. |
| adapters | `config/runtime-config-store.ts` | Default `pkiEnabled` from `AUTH_METHOD` naming PKI so existing installs come up unchanged; extend `redactAuth`. |
| adapters | `auth/pki-cert-adapter.ts` | Resolve `sessionTtlHours` per request from the store. **Remove the constructor throw** on an empty proxy list; return a `CONFIGURATION_ERROR` Result instead. |
| apps/web | `lib/container.ts` | Build `PkiCertAdapter` unconditionally. Config decides whether it answers, not wiring. |
| apps/web | `middleware.ts` | **Delete the `AUTH_METHOD` branch.** Always redirect to `/login`. Middleware stops reading auth config entirely. |
| apps/web | `app/api/auth/cert/route.ts` | Return **403** when `pkiEnabled` is false, replacing the container-presence 404. |
| apps/web | `app/(auth)/login/page.tsx` | Render "Sign in with your certificate" → `/api/auth/cert?redirect=…` when `enabledAuthMethods.pki`. |
| apps/web | `server/routers/settings.ts` | Extend `authConfigInputSchema`; `getAuthConfig` returns `pki.envConfigured: boolean`; `enabledAuthMethods` gains `pki`. |
| apps/web | `components/settings/auth-methods-card.tsx` | The three-state PKI row from §3. |

`getAuthConfig` returns **only the boolean** `envConfigured` — never the IP list
itself. The client has no business knowing the trust anchor's contents, and an
admin-scoped tRPC response is still a network payload.

## 5. The lockout guard (sharp edge — get this right first)

`isAtLeastOneMethodEnabled` currently reads `emailPasswordEnabled ||
entraEnabled`. Once PKI can be the sole method it must count — but only when
**usable**, i.e. the env gate is satisfied.

The failure this prevents: an admin disables email + Entra, leaves PKI on, and
the next deploy ships without `PKI_TRUSTED_PROXY_IPS`. Every method is now
unusable and nobody can sign in to fix it. So the guard takes env state as an
argument and treats an enabled-but-ungated PKI as **not** a method.

Consequence to implement deliberately: `setAuthConfig` must refuse a save that
would leave zero *usable* methods, with a message naming what is missing.

## 6. Database changes

**None.** `auth_config` is a JSON value in `admin_system_settings`, already in
`SENSITIVE_SETTING_KEYS` (encrypted at rest). Additive fields on an existing
JSON blob need no DDL. Reads of rows written before this phase must tolerate the
absent keys and default them — cover it with a test.

## 7. ADR required

ADR-025 §5 states "The PKI / client-certificate path remains env-configured and
outside the admin card this phase… Bringing PKI under the same card is future
work." This phase *is* that work, so §5 must not be left standing as current
guidance.

Write **ADR-042 — PKI under runtime auth config**, superseding ADR-025 §5, and
record specifically: the env/DB split in §2, why the trust anchor does not move,
and the middleware simplification in §8. Amending ADR-025 in place is the wrong
move — the reasoning that made §5 correct at the time should stay readable.

## 8. Behaviour change for existing PKI deployments

Today, a PKI-mode install bounces unauthenticated users straight to
`/api/auth/cert`; they never see a login page. After this phase they land on
`/login` and click "Sign in with your certificate" — one extra click.

This is the deliberate trade for making the DB the source of truth: middleware
runs in the Edge runtime and cannot read config, so the decision has to move to
a page that can. It also unlocks the mixed PKI + password deployment that is
impossible today.

Call this out in the release notes. It is a visible change for an operator who
did not ask for one.

## 9. Risks / open questions

1. **Release-line risk.** This deletes a middleware branch and changes the
   sign-in flow for every existing PKI install. `CLAUDE.md` reserves
   `release/alpha-2` for stabilisation and routes features to `main`. The
   maintainer chose `release/alpha-2` with that trade-off stated; recorded here
   so `/doc-review` can weigh it rather than rediscover it.
2. **Lockout.** §5 is the mitigation. Treat its tests as the first thing
   written, not the last.
3. **`AUTH_METHOD` becomes legacy.** It seeds the initial `pkiEnabled` default
   and nothing else. Decide during build whether to warn on boot when it names
   PKI while the DB says off — a silent contradiction is worse than a log line.
4. **Wizard "configured" semantics.** `wizard-requirements.ts` resolves a step
   via `resolveRequirement(configured, status)`. PKI has no live connectivity
   probe, so if it ever becomes a wizard *requirement* it would be `unsupported`.
   This phase treats auth as it is treated today — not a gated requirement — so
   no change is expected; confirm during build rather than assume.

## 10. Implementation order (tests first)

1. Domain: `AuthConfig` fields, `isPkiUsable`, and the §5 lockout guard.
2. `RuntimeConfigStore` defaulting + redaction, incl. the pre-existing-row case.
3. `PkiCertAdapter` per-request config; drop the constructor throw.
4. Router: schema, `envConfigured`, `enabledAuthMethods.pki`, server-side
   rejection of an ungated enable.
5. `AuthMethodsCard` three-state row (§3).
6. `middleware.ts` simplification + `/login` certificate button + route 403.
7. E2E: `apps/web/e2e/enhance-pki-admin-config.spec.ts` — greyed-out with
   subtext when the env gate is unset; enabled and toggleable when set; the
   certificate button appears on `/login`; sign-in completes through the mock
   proxy at `:4001/pki` (PR #209).
