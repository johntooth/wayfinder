import { isIP } from "node:net";
import type { AuthMethod, PkiEnvDefaults, RuntimeConfigStore } from "@rbrasier/adapters";

interface PkiEnv {
  AUTH_METHOD: string;
  PKI_TRUSTED_PROXY_IPS?: string | undefined;
  PKI_SESSION_TTL_HOURS: number;
}

export interface ResolvedPkiEnv {
  // The addresses the cert adapter enforces against — the one place in the app
  // that needs them.
  trustedProxyIps: string[];
  authMethodNamesPki: boolean;
  // What config resolution is allowed to see: booleans and a number, never the
  // addresses (ADR-042 §1).
  envDefaults: PkiEnvDefaults;
}

/**
 * Resolves PKI's environment half once, for both the trust anchor and the
 * config gate.
 *
 * Entries that are not real addresses are dropped, so a stray
 * `PKI_TRUSTED_PROXY_IPS=,` cannot pass for a trust anchor and then fail to
 * match any request.
 */
export const resolvePkiEnv = (env: PkiEnv): ResolvedPkiEnv => {
  const trustedProxyIps = (env.PKI_TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter((ip) => isIP(ip) !== 0);
  const authMethodNamesPki =
    env.AUTH_METHOD === "pki" || env.AUTH_METHOD === "pki-and-email-password";

  return {
    trustedProxyIps,
    authMethodNamesPki,
    envDefaults: {
      authMethodNamesPki,
      hasTrustedProxies: trustedProxyIps.length > 0,
      sessionTtlHours: env.PKI_SESSION_TTL_HOURS,
    },
  };
};

/**
 * `AUTH_METHOD` seeds a default and decides nothing else, so it can end up
 * naming PKI while the stored config has it off. Say so once at boot rather than
 * leaving an operator to work it out from a sign-in button that never appears
 * (ADR-042 §3).
 */
export const warnOnLegacyAuthMethodContradiction = (
  runtimeConfig: Pick<RuntimeConfigStore, "getAuthConfig">,
  logger: { warn: (message: string) => void },
  authMethodNamesPki: boolean,
): void => {
  if (!authMethodNamesPki) return;
  void runtimeConfig
    .getAuthConfig()
    .then((authConfig) => {
      if (authConfig.pkiEnabled) return;
      logger.warn(
        "AUTH_METHOD names PKI but certificate sign-in is disabled in settings — settings win; the variable only seeds the initial default",
      );
    })
    .catch(() => {
      // Best-effort: a config read failing at boot is already surfaced by
      // whichever request needs it.
    });
};

// PKI is absent by design: certificate sign-in is decided by runtime config, not
// by the process's boot-time mechanism (ADR-042 §3).
export const resolveAuthMethod = (authMethod: string): AuthMethod => {
  switch (authMethod) {
    case "google-oauth":
      return { type: "google-oauth" as const };
    case "other":
      return { type: "other" as const };
    default:
      return { type: "email-password" as const };
  }
};
