import type { GenericOAuthConfig, GenericOAuthUserInfo } from "better-auth/plugins/generic-oauth";

export const COGNITO_PROVIDER_ID = "cognito";
export const DEFAULT_COGNITO_DISPLAY_NAME = "Amazon Cognito";

export interface CognitoProviderOptions {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  // What the sign-in button and its messages call the identity provider.
  readonly displayName: string;
}

export interface CognitoSettings {
  readonly issuer?: string | undefined;
  readonly clientId?: string | undefined;
  readonly clientSecret?: string | undefined;
  readonly displayName?: string | undefined;
}

/**
 * Resolves the Cognito sign-in options from the environment, or null when
 * Cognito must not be offered. Fails closed: any missing setting, or an issuer
 * that is not https, turns it off rather than half-configuring it.
 *
 * Env-only by design, like ENTRA_AUTHORITY: sign-in links accounts by email,
 * so whoever can repoint the issuer can sign in as anyone. That must take a
 * deployment change, not an admin setting.
 */
export const cognitoProviderFor = (settings: CognitoSettings): CognitoProviderOptions | null => {
  const { issuer, clientId, clientSecret } = settings;
  if (!issuer || !clientId || !clientSecret) return null;
  if (!issuer.startsWith("https://")) return null;
  return {
    issuer: issuer.replace(/\/$/, ""),
    clientId,
    clientSecret,
    displayName: settings.displayName?.trim() || DEFAULT_COGNITO_DISPLAY_NAME,
  };
};

/**
 * Cognito's id token carries `email_verified` as a boolean, but its userinfo
 * endpoint sends the string "true" or "false" — and "false" is truthy. Better
 * Auth only links an untrusted provider's identity when the address is
 * verified, so a loose read here would link an unverified address.
 */
export const isCognitoEmailVerified = (profile: Record<string, unknown>): boolean =>
  profile.email_verified === true || profile.email_verified === "true";

/**
 * Better Auth generic-oauth config for a Cognito user pool. Sign-up is off: an
 * admin creates the account in Wayfinder, and a first Cognito sign-in links to
 * it by verified email. Cognito then takes precedence over the password, as
 * Entra does (see applyEntraPrecedence).
 *
 * The issuer and JWKS come from the pool's discovery document. Better Auth
 * checks the callback's iss against that issuer and verifies the id token's
 * signature, issuer, audience and nonce.
 */
export const cognitoOAuthConfig = (options: CognitoProviderOptions): GenericOAuthConfig => ({
  providerId: COGNITO_PROVIDER_ID,
  discoveryUrl: `${options.issuer}/.well-known/openid-configuration`,
  requireIdTokenVerification: true,
  clientId: options.clientId,
  clientSecret: options.clientSecret,
  scopes: ["openid", "email", "profile"],
  pkce: true,
  disableSignUp: true,
  mapProfileToUser: (profile: GenericOAuthUserInfo) => ({ emailVerified: isCognitoEmailVerified(profile) }),
});
