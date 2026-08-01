# Phase — PKI under the admin Authentication card

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 0.22.0 — **MINOR** (new config surface + UI; no DDL)
- **Base branch**: `release/alpha-2` — chosen by the maintainer. See §9 for the
  risk this carries; `/doc-review` should weigh it rather than assume it.
- **PRD**: `docs/development/prd/pki-admin-config.prd.md`
- **ADR**: `docs/development/adr/042-pki-under-runtime-auth-config.adr.md`,
  superseding ADR-025 §5 ("PKI stays as-is").
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
| apps/web | `components/settings/auth-methods-card.tsx` | The three-state PKI row from §3, plus a Test button per enabled method. |
| domain | `entities/connectivity.ts` | `ConnectivityTarget` gains `auth-entra`, `auth-pki`, `auth-email-password`. Leave the existing `entra` target alone (§4a). |
| adapters | `health/connectivity-probes.ts` | `probeAuthEntra`, `probeAuthPki`, `probeAuthEmailPassword`. |
| adapters | `health/composite-connectivity-tester.ts` | Route the three new targets. |
| apps/web | `components/onboarding/setup-wizard.tsx` | A `WizardRequirement` per **enabled** method; extend `requiredReady` (currently storage + AI only, line 80). |

## 4a. Per-method sign-in tests

ADR-041 §2 requires a live Test before a wizard step counts as done. That rule
is applied to storage and AI only — authentication renders ungated, so setup can
finish with an enabled, broken sign-in method. This phase closes that.

One target per method, not one aggregate: the operator needs to know *which*
method failed.

| Target | Verifies |
| ------ | -------- |
| `auth-entra` | OIDC discovery doc from `{authority}/{tenantId}/v2.0/.well-known/openid-configuration`, then a client-credentials token request. |
| `auth-pki` | `PKI_TRUSTED_PROXY_IPS` parses to ≥1 valid address, `pkiEnabled` true, cert route mounted. |
| `auth-email-password` | Credential provider enabled on the built instance, and ≥1 account carries a password. |

**Do not reuse the existing `entra` target.** It probes Graph `/users` and needs
the `User.Read.All` application permission, which serves the people-directory
feature — sign-in needs none of it. A registration configured correctly for
sign-in only would fail it while sign-in works. Gating the wizard on that probe
would block setup on a permission the login flow never uses.

**`auth-pki` must not overstate itself.** The app is behind the proxy and cannot
originate a certificate handshake, so this is a configuration check. Its success
message says so.

Only **enabled** methods are tested and gate. That is also the escape hatch when
a probe fails transiently: turning the method off unblocks the wizard.

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

## 7. ADR — written

ADR-025 §5 stated "The PKI / client-certificate path remains env-configured and
outside the admin card this phase… Bringing PKI under the same card is future
work." This phase *is* that work, so §5 could not be left standing as current
guidance.

**[ADR-042 — PKI Under Runtime Auth Config, and Per-Method Sign-In
Verification](../adr/042-pki-under-runtime-auth-config.adr.md)** supersedes it,
recording the env/DB split (§2), why the trust anchor does not move, the
middleware simplification (§8), and the per-method wizard tests (§4a).

ADR-025 §5 was **not** rewritten — it carries a pointer to ADR-042 and keeps its
original text, so the reasoning that made the deferral correct at the time stays
readable.

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
4. **Wizard "configured" semantics.** `resolveRequirement(configured, status)`
   maps a configured target with no live probe to `unsupported`, which counts as
   satisfied. All three auth probes in §4a return a real ok/failed status, so
   none should land there — if one does, the gate silently passes. Assert the
   status explicitly in tests rather than trusting the default.
5. **Gating setup on auth tests can strand an operator.** A transient Entra
   outage makes the wizard unfinishable. Disabling the method is the escape
   hatch, since only enabled methods gate — confirm the UI makes that obvious
   rather than leaving the operator stuck on a red badge.
6. **The `entra` badge changes meaning.** After this phase, `entra` (Graph)
   and `auth-entra` (sign-in) answer different questions. Anyone reading the old
   badge as "sign-in works" was already wrong, but the split makes it explicit —
   check nothing in the UI implies otherwise.

## 10. Implementation order (tests first)

1. Domain: `AuthConfig` fields, `isPkiUsable`, and the §5 lockout guard.
2. `RuntimeConfigStore` defaulting + redaction, incl. the pre-existing-row case.
3. `PkiCertAdapter` per-request config; drop the constructor throw.
4. Router: schema, `envConfigured`, `enabledAuthMethods.pki`, server-side
   rejection of an ungated enable.
5. `AuthMethodsCard` three-state row (§3).
6. `middleware.ts` simplification + `/login` certificate button + route 403.
7. Connectivity targets + the three probes (§4a), each with a test asserting no
   secret material reaches `message`.
8. Wizard requirements per enabled method; extend `requiredReady`.
9. E2E: `apps/web/e2e/enhance-pki-admin-config.spec.ts` — greyed-out with
   subtext when the env gate is unset; enabled and toggleable when set; the
   certificate button appears on `/login`; sign-in completes through the mock
   proxy at `:4001/pki` (PR #209); the wizard blocks Finish while an enabled
   method's test has not passed, and unblocks when that method is disabled.

Step 0 is **write ADR-042** — done; `docs/development/adr/042-pki-under-runtime-auth-config.adr.md`.
