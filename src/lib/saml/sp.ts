import { SAML } from "@node-saml/node-saml";

interface SpConfig {
  entryPoint: string;
  issuer: string;
  idpCert: string;
  callbackUrl: string;
}

export function createSpValidator(config: SpConfig) {
  return new SAML({
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    idpCert: config.idpCert,
    callbackUrl: config.callbackUrl,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
  });
}

export async function validateSamlResponse(
  saml: SAML,
  samlResponse: string
): Promise<{ profile: Record<string, unknown> | null; loggedOut: boolean }> {
  const { profile, loggedOut } = await saml.validatePostResponseAsync({
    SAMLResponse: samlResponse,
  });
  return { profile: profile as Record<string, unknown> | null, loggedOut };
}
