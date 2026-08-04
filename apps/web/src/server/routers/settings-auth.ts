import { z } from "zod";
import type { AuthConfig } from "@rbrasier/domain";

// The auth card's input contract, kept beside the merge it feeds so the two
// stay in step when a method is added.
export const authConfigInputSchema = z.object({
  emailPasswordEnabled: z.boolean(),
  entraEnabled: z.boolean(),
  entra: z.object({
    tenantId: z.string().default(""),
    clientId: z.string().default(""),
    // Empty/omitted secret keeps the stored one — admins can't read it back.
    clientSecret: z.string().nullable().optional(),
  }),
  // Omitted by an older client: keep whatever is stored rather than reading the
  // absence as "turn PKI off".
  pkiEnabled: z.boolean().optional(),
  pki: z
    .object({
      sessionTtlHours: z.number().int().positive().max(24 * 30),
    })
    .optional(),
});

type AuthConfigInput = {
  emailPasswordEnabled: boolean;
  entraEnabled: boolean;
  entra: { tenantId: string; clientId: string; clientSecret?: string | null };
  pkiEnabled?: boolean;
  pki?: { sessionTtlHours: number };
};

/**
 * Merge an incoming auth config with the stored one. A blank/omitted secret
 * keeps the previously-stored value so saving the form does not wipe a secret
 * the admin can never read back from the redacted display.
 */
export const mergeAuthConfig = (incoming: AuthConfigInput, stored: AuthConfig): AuthConfig => ({
  emailPasswordEnabled: incoming.emailPasswordEnabled,
  entraEnabled: incoming.entraEnabled,
  entra: {
    tenantId: incoming.entra.tenantId,
    clientId: incoming.entra.clientId,
    clientSecret:
      incoming.entra.clientSecret && incoming.entra.clientSecret.length > 0
        ? incoming.entra.clientSecret
        : stored.entra.clientSecret,
  },
  pkiEnabled: incoming.pkiEnabled ?? stored.pkiEnabled,
  pki: { sessionTtlHours: incoming.pki?.sessionTtlHours ?? stored.pki.sessionTtlHours },
});
