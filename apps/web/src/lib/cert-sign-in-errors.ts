// Why a certificate sign-in did not complete, as a closed set of codes.
//
// The cert route redirects a failed browser navigation to /login with one of
// these rather than its own message: the login page owns the wording, and a
// server-side string never gets reflected into the page.
export type CertSignInError =
  // No x-ssl-client-* headers at all — almost always a browser pointed straight
  // at the app with no mTLS proxy in front of it.
  | "no_certificate"
  // A certificate was presented but the proxy or the chain was not trusted.
  | "rejected"
  // The certificate carried no address the app could turn into an account.
  | "no_identity"
  // Enabled, but the deployment cannot honour it — an empty trusted-proxy list.
  | "misconfigured"
  // Certificate sign-in is switched off, or its environment gate is unmet.
  | "disabled";

export const CERT_SIGN_IN_ERROR_PARAM = "certError";

const MESSAGES: Record<CertSignInError, string> = {
  no_certificate:
    "No client certificate reached the app. This link only works from behind your organisation's certificate proxy — opening it directly will always fail.",
  rejected:
    "Your certificate was not accepted. It may have been issued by an authority this deployment does not trust, or forwarded by a proxy that is not on the trusted list.",
  no_identity:
    "Your certificate did not carry an email address, so there is no account to sign in to. Ask your IT team for a certificate with an email in its subject or SAN.",
  misconfigured:
    "Certificate sign-in is switched on but not finished being set up. Ask an administrator to check the trusted proxy configuration.",
  disabled: "Certificate sign-in is not enabled on this deployment.",
};

const isCertSignInError = (value: string): value is CertSignInError => value in MESSAGES;

// Unknown or absent codes yield null rather than an error, so a hand-edited URL
// renders the plain login form instead of a broken banner.
export const certSignInErrorMessage = (raw: string | null): string | null => {
  if (!raw || !isCertSignInError(raw)) return null;
  return MESSAGES[raw];
};
