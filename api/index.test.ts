import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CORY_USER_PRINCIPAL_NAME } from "./simulated-user.js";

const state = vi.hoisted(() => ({
  providerOptions: [] as Array<Record<string, unknown>>,
  serverOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@azure/identity", () => ({
  ManagedIdentityCredential: class {},
}));

vi.mock("./config.js", () => ({
  loadApiConfig: () => ({
    host: "127.0.0.1",
    port: 3000,
    issuer: "https://issuer.example/",
    audience: "api://audience",
    jwksUrl: "https://issuer.example/keys",
    allowInsecureJwks: false,
    callerPolicy: {
      tenantId: "92563293-315c-4b6c-9b90-bcb47ee8c970",
      delegatedUserObjectIds: [],
      automationClientId: "11111111-1111-4111-8111-111111111111",
    },
    simulatedUsersCba: {
      clientId: "22222222-2222-4222-8222-222222222222",
      cory: {
        objectId: "33333333-3333-4333-8333-333333333333",
        pfxPath: "/run/secrets/cory.pfx",
        pfxPassphrase: "cory-passphrase",
      },
    },
  }),
}));

vi.mock("./simulated-user-cba.js", () => ({
  SimulatedUserDelegatedTokenProvider: class {
    constructor(options: Record<string, unknown>) {
      state.providerOptions.push(options);
    }
  },
}));

vi.mock("./server.js", () => ({
  createApiServer: (options: Record<string, unknown>) => {
    state.serverOptions.push(options);
    return {
      listen: (
        _port: number,
        _host: string,
        callback: () => void,
      ): void => callback(),
      once: (): void => undefined,
      address: (): { port: number } => ({ port: 3000 }),
      close: (): void => undefined,
      closeIdleConnections: (): void => undefined,
    };
  },
}));

describe("API simulated-user wiring", () => {
  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process, "on").mockImplementation(() => process);
    await import("./index.js");
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("constructs Cory operations without Homer configuration", () => {
    expect(state.providerOptions).toHaveLength(1);
    expect(state.providerOptions[0]).toMatchObject({
      clientId: "22222222-2222-4222-8222-222222222222",
      pfxPath: "/run/secrets/cory.pfx",
      pfxPassphrase: "cory-passphrase",
      identity: { userPrincipalName: CORY_USER_PRINCIPAL_NAME },
    });

    expect(state.serverOptions).toHaveLength(1);
    expect(state.serverOptions[0]).toMatchObject({
      simulatedEmailOperation: undefined,
      oneDriveShareProofOperation: undefined,
      calendarMeetingOperation: expect.anything(),
      contactProofOperation: expect.anything(),
      inboxRuleProofOperation: expect.anything(),
      categoryProofOperation: expect.anything(),
      draftProofOperation: expect.anything(),
      todoTaskProofOperation: expect.anything(),
      operationTelemetryReader: expect.anything(),
    });
  });
});
