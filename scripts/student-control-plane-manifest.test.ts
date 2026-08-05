import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifestPath = "infra/student-control-plane.manifest.json";
const manifestText = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText) as Record<string, unknown>;

const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const permittedUuidPath = /(?:^|\.)(?:applicationId|identifierUri|id|templateId|roleDefinitionId)$/u;
const bindingClasses = new Set([
  "stable",
  "human-supplied",
  "generated",
  "discovered",
  "intentionally-excluded-historical",
]);

describe("Student control-plane reconstruction manifest", () => {
  it("parses with the exact high-level authority counts", () => {
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      kind: "ap2-pass3-student-control-plane",
      status: "reconstruction-intent-only",
    });

    const permissions = manifest.consentAndPermissionManifests as Record<
      string,
      unknown[]
    >;
    expect(permissions.devAutomationApplicationPermissions).toHaveLength(48);
    expect(
      permissions.apiRuntimeManagedIdentityMicrosoftGraphApplicationPermissions,
    ).toHaveLength(16);
    expect(
      permissions.productEnterpriseApplicationDelegatedMicrosoftGraphScopes,
    ).toHaveLength(16);
  });

  it("contains no obvious secret material or old Student binding", () => {
    expect(manifestText).not.toMatch(/-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/u);
    expect(manifestText).not.toMatch(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u);
    expect(manifestText).not.toMatch(/(?:AccountKey|SharedAccessSignature|client_secret|refresh_token)=/iu);
    expect(manifestText).not.toMatch(/@[A-Za-z0-9.-]+\.onmicrosoft\.com/iu);

    walk(manifest, [], (value, path) => {
      if (typeof value === "string" && [...value.matchAll(uuid)].length > 0) {
        expect(path.join(".")).toMatch(permittedUuidPath);
      }
    });
  });

  it("uses only declared binding classifications", () => {
    let bindingCount = 0;
    walk(manifest, [], (value, path) => {
      if (path.at(-1) === "bindingClass") {
        bindingCount += 1;
        expect(bindingClasses).toContain(value);
      }
    });
    expect(bindingCount).toBeGreaterThan(100);
  });
});

function walk(
  value: unknown,
  path: string[],
  visit: (value: unknown, path: string[]) => void,
): void {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...path, String(index)], visit));
  } else if (value !== null && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) =>
      walk(item, [...path, key], visit)
    );
  }
}
