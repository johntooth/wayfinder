# Implementation summary — mock PKI client-certificate proxy (v0.21.6)

## What shipped

A mock PKI front door at `:4001/pki` on the shared mocks server, the counterpart
to the mock Entra provider added in v0.21.4. Because PKI's contract is with an
mTLS-terminating reverse proxy rather than an identity provider, the mock stands
in for nginx: it presents a certificate picker, forwards the choice to
`/api/auth/cert` as `x-ssl-client-*` headers from a trusted source IP, replays
the app's session cookie to the browser, and hands the browser back to the app.

## Running it

Local:

```bash
./restart.sh --with-pki          # boots the app with AUTH_METHOD=pki-and-email-password
                                 # and PKI_TRUSTED_PROXY_IPS=127.0.0.1
open http://localhost:4001/pki/connect?redirect=/chats
```

`--with-mocks` alone starts the mock but leaves the app in its configured auth
mode; the picker will then get a 404 from the cert route, which the mock renders
as a rejection page. PKI is a boot-time mode, not an in-app toggle.

CI: a dedicated `e2e-pki` job in `.github/workflows/e2e.yml` boots a second app
in PKI mode and runs the `pki` Playwright project. It is a separate job rather
than a shard because `AUTH_METHOD` changes where `middleware.ts` sends
unauthenticated requests, which would rewrite every other spec's sign-in path.

## Test cover

**E2E — `apps/web/e2e/enhance-mock-pki-login.spec.ts`** (project `pki`, skips
itself when the mocks server is down or PKI auth is off):

1. A certificate signs in and provisions the account just-in-time.
2. The address in the certificate is the account key, not the fingerprint — a
   certificate for an address that already has a password account lands in that
   account, and a second presentation keeps it.
3. A certificate that fails chain verification mints no session.

**Unit — `packages/adapters/src/auth/__tests__/pki-cert-adapter.test.ts`**: four
new cases under "the address is the account key" covering account adoption,
mixed-case matching, fingerprint rotation, and a new address on the same
certificate. 20 tests pass.

The mock's own request/response behaviour was verified directly against a stub
that mirrors `route.ts` — happy path, CN fallback with the SAN omitted, failed
verification, and an open-redirect attempt on the `redirect` parameter.

## Answer to the question that prompted this

**Yes — PKI keys on email exactly as Entra does.**
`PkiCertAdapter.findOrCreateUser` looks the user up with
`findByEmail(normaliseEmail(email))` and creates only on a miss;
`cert_fingerprint` and `cert_subject_dn` are written on every login but never
read to find a user. One address is one `core_users` row across both methods.

## Bug fixed: certificate sign-in dead-ended on 405

Building the mock surfaced a defect unit tests could not reach: **PKI browser
sign-in never completed.** `middleware.ts` redirects unauthenticated page
requests to `/api/auth/cert`, the browser follows with a GET, and the route
exported only `POST` — so Next answered 405.

`signInWithCertificate` is now shared behind both `GET` and `POST`. GET is the
production path; the mTLS proxy attaches `x-ssl-client-*` to that navigation
like any other request. Minting a session from a GET is safe here because the
identity comes only from headers the trusted proxy sets, never from ambient
browser credentials — so it cannot be forged cross-site.

Covered by `apps/web/src/app/api/auth/cert/route.test.ts` (6 cases) plus an e2e
case asserting 401-not-405 on a bare GET.

## Recorded, not changed

- **PKI has no precedence rule.** Entra runs `applyEntraPrecedence` to destroy
  the credential row on link; PKI adopts an existing password account and leaves
  the password working. A product decision, not a mock's.
- **PKI has no `/admin/settings` switch.** It is the only method configured
  purely by environment. See the phase doc for why, and what making it
  configurable would take.

## Version

PATCH → **0.21.6**. Tooling, test cover, and one bug fix; no schema change.
