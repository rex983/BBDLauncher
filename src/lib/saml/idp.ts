import * as crypto from "crypto";
import { SignedXml } from "xml-crypto";
import { getIdpCertificate, getIdpPrivateKey } from "./certificates";

interface AssertionParams {
  nameId: string;
  nameIdFormat?: string;
  audience: string;
  acsUrl: string;
  inResponseTo?: string;
  attributes?: Record<string, string>;
  sessionIndex?: string;
}

function generateId(): string {
  return "_" + crypto.randomBytes(16).toString("hex");
}

function formatDateTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function generateSamlAssertion(params: AssertionParams): string {
  const entityId = process.env.SAML_ENTITY_ID || "https://launcher.bigbuildingsdirect.com";
  const now = new Date();
  const notBefore = new Date(now.getTime() - 5 * 60 * 1000); // 5 min skew
  const notOnOrAfter = new Date(now.getTime() + 5 * 60 * 1000);
  const sessionNotOnOrAfter = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour

  const responseId = generateId();
  const assertionId = generateId();
  const sessionIndex = params.sessionIndex || generateId();
  const nameIdFormat =
    params.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";

  let attributeStatements = "";
  if (params.attributes && Object.keys(params.attributes).length > 0) {
    const attrs = Object.entries(params.attributes)
      .map(
        ([name, value]) => `
        <saml:Attribute Name="${escapeXml(name)}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">
          <saml:AttributeValue xsi:type="xs:string">${escapeXml(value)}</saml:AttributeValue>
        </saml:Attribute>`
      )
      .join("");
    attributeStatements = `
      <saml:AttributeStatement>${attrs}
      </saml:AttributeStatement>`;
  }

  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema" Version="2.0" ID="${assertionId}" IssueInstant="${formatDateTime(now)}">
    <saml:Issuer>${escapeXml(entityId)}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="${nameIdFormat}">${escapeXml(params.nameId)}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData${params.inResponseTo ? ` InResponseTo="${escapeXml(params.inResponseTo)}"` : ""} NotOnOrAfter="${formatDateTime(notOnOrAfter)}" Recipient="${escapeXml(params.acsUrl)}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${formatDateTime(notBefore)}" NotOnOrAfter="${formatDateTime(notOnOrAfter)}">
      <saml:AudienceRestriction>
        <saml:Audience>${escapeXml(params.audience)}</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${formatDateTime(now)}" SessionNotOnOrAfter="${formatDateTime(sessionNotOnOrAfter)}" SessionIndex="${sessionIndex}">
      <saml:AuthnContext>
        <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
      </saml:AuthnContext>
    </saml:AuthnStatement>${attributeStatements}
  </saml:Assertion>`;

  // Sign the assertion
  const sig = new SignedXml({
    privateKey: getIdpPrivateKey(),
    publicCert: getIdpCertificate(),
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });

  sig.addReference({
    xpath: `//*[local-name(.)='Assertion']`,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });

  sig.computeSignature(assertion, {
    location: { reference: `//*[local-name(.)='Issuer']`, action: "after" },
  });

  const signedAssertion = sig.getSignedXml();

  // Wrap in SAML Response
  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${responseId}" Version="2.0" IssueInstant="${formatDateTime(now)}"${params.inResponseTo ? ` InResponseTo="${escapeXml(params.inResponseTo)}"` : ""} Destination="${escapeXml(params.acsUrl)}">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${escapeXml(entityId)}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  ${signedAssertion}
</samlp:Response>`;

  return response;
}

export function generateAutoSubmitForm(acsUrl: string, samlResponse: string, relayState?: string): string {
  const encodedResponse = Buffer.from(samlResponse).toString("base64");
  return `<!DOCTYPE html>
<html>
<head><title>SSO Redirect</title></head>
<body onload="document.forms[0].submit()">
  <noscript><p>Redirecting to application. Click the button if not redirected automatically.</p></noscript>
  <form method="POST" action="${escapeHtml(acsUrl)}">
    <input type="hidden" name="SAMLResponse" value="${encodedResponse}"/>
    ${relayState ? `<input type="hidden" name="RelayState" value="${escapeHtml(relayState)}"/>` : ""}
    <noscript><button type="submit">Continue</button></noscript>
  </form>
</body>
</html>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
