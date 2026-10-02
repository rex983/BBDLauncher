import { z } from "zod";

export const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "URL must start with http:// or https://",
  });

// Sign-on endpoints receive signed launch tokens, so they must be real
// http(s) URLs. Blank is allowed for fields the chosen SSO type doesn't use.
const endpoint = z.union([httpUrl, z.literal("")]).optional();

export const ssoConfigSchema = z.object({
  sp_entity_id: z.string().optional(),
  acs_url: endpoint,
  slo_url: endpoint,
  oauth_client_id: z.string().optional(),
  oauth_client_secret: z.string().optional(),
  oauth_authorize_url: endpoint,
  oauth_token_url: endpoint,
  jwt_acs_url: endpoint,
  jwt_audience: z.string().optional(),
});
