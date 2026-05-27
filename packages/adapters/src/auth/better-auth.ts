import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "../db/client";
import { core_accounts, core_sessions, core_users, core_verification_tokens } from "../db/schema/core";
import type { PkiConfig } from "./pki-cert-adapter";

export type AuthMethod =
  | { readonly type: "email-password" }
  | { readonly type: "pki"; readonly pkiConfig: PkiConfig }
  | { readonly type: "pki-and-email-password"; readonly pkiConfig: PkiConfig }
  | { readonly type: "google-oauth" }
  | { readonly type: "other" };

export interface AuthConfig {
  readonly secret: string;
  readonly baseURL: string;
  readonly adminSeedEmail: string | undefined;
  readonly authMethod: AuthMethod;
}

/**
 * Minimal structural surface of the Better Auth instance that this template
 * actually uses. Declared explicitly so TypeScript does not have to spell out
 * Better Auth's full inferred type — which transitively references zod's
 * internal modules and breaks portable declaration emit across packages.
 */
export interface Auth {
  readonly handler: (req: Request) => Promise<Response>;
  readonly api: Readonly<Record<string, unknown>>;
}

/**
 * Constructs a Better Auth instance backed by Drizzle.
 *
 * The first user signing in with ADMIN_SEED_EMAIL is promoted to admin via
 * `seedAdmin` — call it once from the app's container after migrations.
 */
export const createAuth = (db: Database, config: AuthConfig): Auth => {
  if (config.authMethod.type === "google-oauth") {
    throw new Error(
      "google-oauth requires additional setup. See docs/guides/google-oauth.md for configuration steps.",
    );
  }

  const emailPasswordEnabled =
    config.authMethod.type === "email-password" ||
    config.authMethod.type === "pki-and-email-password";

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: core_users,
        session: core_sessions,
        account: core_accounts,
        verification: core_verification_tokens,
      },
    }),
    secret: config.secret,
    baseURL: config.baseURL,
    user: {
      modelName: "user",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "session",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    account: {
      modelName: "account",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "verification",
      fields: {
        value: "token",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    emailAndPassword: {
      enabled: emailPasswordEnabled,
      autoSignIn: true,
      requireEmailVerification: false,
    },
  }) as unknown as Auth;
};
