import { normaliseEmail } from "@rbrasier/domain";

export interface EntraUserInfo {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified: boolean;
  };
  readonly data: Record<string, unknown>;
}

const decodeClaims = (idToken: string): Record<string, unknown> | null => {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const claims: unknown = JSON.parse(decoded);
    if (!claims || typeof claims !== "object") return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * Resolves the signed-in identity from the id token alone.
 *
 * Better Auth's stock Microsoft `getUserInfo` also calls Microsoft Graph for a
 * profile photo, against a hardcoded graph.microsoft.com. That call is not
 * optional and `betterFetch` throws when the host is unreachable, so sign-in
 * fails outright on a machine that cannot reach Graph — which is every offline
 * developer and the local mock identity provider. Wherever the authority has
 * been overridden, Graph is not the right host anyway.
 *
 * No signature check: the token was just fetched over TLS in a direct
 * server-to-server code exchange, which is the same basis on which Better
 * Auth's own implementation decodes it without verifying.
 */
export const userInfoFromIdToken = (token: { idToken?: string }): EntraUserInfo | null => {
  if (!token.idToken) return null;

  const claims = decodeClaims(token.idToken);
  if (!claims) return null;

  const email = asString(claims.email) ?? asString(claims.preferred_username);
  if (!email) return null;

  const subject = asString(claims.sub);
  if (!subject) return null;

  return {
    user: {
      id: subject,
      name: asString(claims.name) ?? email,
      email: normaliseEmail(email),
      emailVerified: claims.email_verified === true,
    },
    data: claims,
  };
};
