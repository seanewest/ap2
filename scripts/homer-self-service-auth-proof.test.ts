import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "scripts/homer-self-service-auth-proof.mjs"),
  "utf8",
);

describe("Homer self-service authentication proof", () => {
  it("binds the live mutation to exact supported actors and a fresh CBA browser", () => {
    expect(source).toContain("92563293-315c-4b6c-9b90-bcb47ee8c970");
    expect(source).toContain("6e54e3a9-7651-4520-a331-047550ae6fca");
    expect(source).toContain("homer.simpson@corywest.onmicrosoft.com");
    expect(source).toContain("1e99b11d-f3b0-4e6f-86b5-1b4bf95012e9");
    expect(source).toContain("rachel.green@corywest.onmicrosoft.com");
    expect(source).toContain("https://mysignins.microsoft.com/security-info");
    expect(source).toContain("clientCertificates");
    expect(source).not.toContain("storageState");
  });

  it("keeps Rachel's AP2 sign-in and passkey registration in one distinct context", () => {
    expect(source).toContain("AP2-RACHEL-CHAIN-");
    expect(source).toContain("authenticateAp2Session");
    expect(source).toContain("sameContextContinuesToSecurityInfo: true");
    expect(source).toContain("secondary-session.json");
    expect(source).not.toContain("storageState");
  });

  it("uses one deterministic user-verified CTAP2 security-key authenticator", () => {
    expect(source).toContain('protocol: "ctap2"');
    expect(source).toContain('transport: "usb"');
    expect(source).toContain("hasResidentKey: true");
    expect(source).toContain("hasUserVerification: true");
    expect(source).toContain("isUserVerified: true");
    expect(source).toContain("automaticPresenceSimulation: true");
    expect(source).toContain('getByText("Passkey", { exact: true })');
  });

  it("fails closed around prior methods and cleans up through Homer's portal", () => {
    expect(source).toContain('mode === "register"');
    expect(source).toContain("fidoMethods.length !== 0");
    expect(source).toContain('mode === "cleanup"');
    expect(source).toContain('button[aria-label="Delete Passkey"]:visible');
    expect(source).toContain("Marked passkey deletion did not reach Graph inventory");
    expect(source).not.toContain("/authentication/fido2Methods/");
  });

  it("preserves only sanitized Microsoft-side observations", () => {
    expect(source).toContain("authenticationMethodsPolicy");
    expect(source).toContain("auditLogs/directoryAudits");
    expect(source).toContain("auditLogs/signIns");
    expect(source).toContain("userRegistrationDetails");
    expect(source).not.toMatch(/console\.log\([^\n]*(graphToken|pfxPassphrase)/);
  });
});
