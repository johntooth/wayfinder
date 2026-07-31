# Enhancement — mock PKI client-certificate proxy on the shared mocks server

## Why

v0.21.4 added a mock Microsoft Entra provider at `:4001/entra`, which made the
whole OAuth code flow drivable locally and in CI without an Azure tenant. PKI —
the other configurable sign-in method (ADR-025) — had no equivalent, so
`PkiCertAdapter` was covered only by unit tests. Nothing exercised the route,
the trusted-proxy check, the session cookie, or the browser's arrival at an
authenticated page.

## What PKI actually is, and therefore what to mock

PKI is not a redirect-based identity provider. There is no authority to point
at, so the Entra mock's shape does not transfer. Wayfinder's contract
(`PkiCertAdapter`, `apps/web/src/app/api/auth/cert/route.ts`) is with a **reverse
proxy that terminates mTLS** and forwards the verified certificate as headers:

| Header | Meaning |
|---|---|
| `x-ssl-client-verified` | `SUCCESS` when the CA chain validated |
| `x-ssl-client-subject-dn` | the certificate subject |
| `x-ssl-client-fingerprint` | stable per-certificate identifier |
| `x-ssl-client-san-email` | SAN rfc822Name, when the certificate carries one |

The app trusts those headers only from a source IP in `PKI_TRUSTED_PROXY_IPS`.
So the thing to mock is **nginx with `ssl_verify_client on`**, not an IdP.

## Design

A new mock at `:4001/pki` on the shared mocks server, following the contract at
the top of `mocks/server.mjs` (one port, one path per mock).

```
GET  /pki/connect?redirect=/chats   → certificate picker
POST /pki/connect                   → forward to the app as that certificate
```

The picker submission is server-to-server. The mock POSTs to the app's
`/api/auth/cert` with the certificate headers and `x-forwarded-for` set to a
trusted IP, takes the session cookie off the app's 302, replays it to the
browser, and redirects the browser to the app.

This side-door shape — rather than a true inline proxy — is deliberate. Cookie
scope ignores port, so a cookie set from `localhost:4001` is presented to the
app on `localhost:3000`; the mock therefore never has to proxy Next.js asset
requests, and the mocks server keeps its one-port-many-paths model.

### What the picker can issue

- Three seeded certificates for `ada@`, `grace@` and `admin@example.com` — the
  same addresses the mock Entra provider seeds, so the two methods collide on
  one identity and "one address is one account" stays testable across them.
- Any typed address, with two toggles that reach the adapter's other branches:
  - **omit SAN email** — forces the CN fallback in `extractIdentity`
  - **fail chain verification** — sends `x-ssl-client-verified: FAILED`

Fingerprints are a SHA-256 of the address, so they are stable across restarts: a
repeat sign-in refreshes the same `cert_fingerprint` instead of looking like a
newly issued certificate.

### Boot wiring

PKI differs from Entra in one way that shapes the tooling: it is **not an in-app
toggle**. `lib/container.ts` builds `PkiCertAdapter` only when `AUTH_METHOD`
names PKI, and the adapter refuses to construct with an empty trusted-proxy
list. `AUTH_METHOD` is also read by `middleware.ts`, where it changes where
unauthenticated requests are sent.

That is why the local flag is `--with-pki` rather than folding into
`--with-mocks`, and why CI gets a separate `e2e-pki` job rather than a shard:
switching `AUTH_METHOD` on for the main suite would change every other spec's
sign-in path.

## Verified findings

### The address inside the certificate is the account key

Confirmed by reading `PkiCertAdapter.findOrCreateUser`: it resolves the user via
`userRepository.findByEmail(normaliseEmail(email))` and creates only on a miss.
`cert_fingerprint` and `cert_subject_dn` are written on every login by
`updateCertFields` and **never read to find a user**.

This is the same rule Entra sign-in follows, so the two methods converge on one
`core_users` row for one address. Consequences, now pinned by tests:

- A re-issued certificate (new fingerprint, same address) keeps the account.
- One certificate naming a new address provisions a new account.
- Case does not fork the account — `normaliseEmail` was applied to this path in
  v0.21.4.

### Two asymmetries with Entra, recorded but not changed here

Both are out of scope for a mock, and both deserve their own deliberate change:

1. **No precedence rule.** Entra sign-in runs `applyEntraPrecedence`, which
   deletes the credential row and revokes sessions once a Microsoft identity
   attaches. PKI has no equivalent: a certificate presented for an address that
   already has a password account adopts that account and leaves the password
   working. Whether that is correct is a product decision, not a mock's.

2. **`/api/auth/cert` is POST-only, but `middleware.ts` redirects to it with a
   GET.** In a PKI mode, an unauthenticated request to `/admin` is 302'd to
   `/api/auth/cert?redirect=/admin`, which the browser follows as a GET; the
   route exports only `POST`, so Next answers 405. The mock does not depend on
   this path (it POSTs directly), so it is not fixed here — and making a
   session-minting endpoint answer GET has CSRF implications worth weighing
   separately.

## Files

| File | Change |
|---|---|
| `mocks/pki/proxy.mjs` | new — the mock mTLS reverse proxy |
| `mocks/server.mjs` | register the mock |
| `restart.sh` | `--with-pki` flag; `MOCK_PKI_APP_ORIGIN` export |
| `.env.example` | point the PKI block at the mock |
| `apps/web/e2e/enhance-mock-pki-login.spec.ts` | new — e2e cover |
| `apps/web/e2e/playwright.config.ts` | `pki` project, excluded from `chromium` |
| `.github/workflows/e2e.yml` | `e2e-pki` job |
| `packages/adapters/src/auth/__tests__/pki-cert-adapter.test.ts` | account-key tests |

## Version

PATCH → **0.21.5**. Dev and test tooling plus test cover; no schema change, no
change to application behaviour.
