import { describe, expect, it } from "vitest";
import { parseInstallationConfig } from "./model.ts";

const anotherStudentInstallation = {
  schemaVersion: 1,
  installationId: "second-student",
  student: {
    tenantId: "10000000-0000-4000-8000-000000000001",
    initialDomain: "second.onmicrosoft.com",
    delegatedOperatorObjectIds: ["10000000-0000-4000-8000-000000000002"],
    automationClientId: "10000000-0000-4000-8000-000000000003",
  },
  actors: {
    cory: actor("4", "Cory West", "cory"),
    homer: actor("5", "Homer Simpson", "homer.simpson"),
    kobe: actor("6", "Kobe West", "kobe"),
    marge: actor("7", "Marge Simpson", "marge.simpson"),
  },
  azure: {
    subscriptionId: "10000000-0000-4000-8000-000000000008",
    apiResourceGroup: "rg-second-api",
    apiContainerApp: "ca-second-api",
  },
  spa: {
    apiBaseUrl: "https://api.second.example/base/",
    allowedOrigin: "https://spa.second.example/",
  },
};

describe("installation configuration", () => {
  it("accepts and normalizes another Student installation without secrets", () => {
    expect(parseInstallationConfig(anotherStudentInstallation)).toMatchObject({
      installationId: "second-student",
      student: { tenantId: "10000000-0000-4000-8000-000000000001" },
      actors: {
        homer: { userPrincipalName: "homer.simpson@second.onmicrosoft.com" },
      },
      azure: { apiContainerApp: "ca-second-api" },
      spa: {
        apiBaseUrl: "https://api.second.example/base",
        allowedOrigin: "https://spa.second.example",
      },
    });
    expect(JSON.stringify(anotherStudentInstallation)).not.toMatch(
      /password|passphrase|credential|private.?key|secret/i,
    );
  });

  it("rejects an actor binding outside the installation Student domain", () => {
    expect(() => parseInstallationConfig({
      ...anotherStudentInstallation,
      actors: {
        ...anotherStudentInstallation.actors,
        kobe: {
          ...anotherStudentInstallation.actors.kobe,
          userPrincipalName: "kobe@another.onmicrosoft.com",
        },
      },
    })).toThrow("must belong to the Student domain");
  });
});

function actor(idSuffix: string, displayName: string, alias: string) {
  return {
    objectId: `10000000-0000-4000-8000-00000000000${idSuffix}`,
    displayName,
    userPrincipalName: `${alias}@second.onmicrosoft.com`,
  };
}
