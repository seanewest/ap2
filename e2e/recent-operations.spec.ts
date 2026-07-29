import { generateKeyPairSync, sign } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createLocalJWKSet, type JWK } from "jose";
import { expect, test } from "@playwright/test";
import { defaultCallerPolicy } from "../api/auth-policy";
import {
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity";
import { InMemoryOperationTelemetryCollector } from "../api/operation-telemetry-collector";
import { createApiServer } from "../api/server";
import { JoseTokenVerifier } from "../api/token-verifier";

const ISSUER = "https://fixture.invalid/operator/v2.0";
const AUDIENCE = "api://ap2-local-fixture";
const KEY_ID = "local-fixture-key";
const NOW = 2_000_000_000;
const APP_ORIGIN = "http://127.0.0.1:5173";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: KEY_ID,
  alg: "RS256",
  use: "sig",
} as JWK;

let apiServer: Server;
let apiBaseUrl: string;
let accessToken: string;

test.beforeAll(async () => {
  const collector = new InMemoryOperationTelemetryCollector();
  collector.record({
    schemaVersion: 1,
    markerHash: "m1_0123456789abcdef01234567",
    operationKind: "calendar.create",
    phase: "execution",
    outcome: "succeeded",
    durationMs: 18,
    reason: "none",
    ambiguityState: "none",
    recoveryState: "not-needed",
    upstreamStatus: 201,
  });
  collector.record({
    schemaVersion: 1,
    markerHash: "m1_89abcdef0123456701234567",
    operationKind: "calendar.cancel",
    phase: "recovery",
    outcome: "ambiguous",
    durationMs: 1_250,
    reason: "upstream-unavailable",
    ambiguityState: "possible-mutation",
    recoveryState: "unresolved",
    upstreamStatus: 503,
  });
  apiServer = createApiServer({
    tokenVerifier: new JoseTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
      now: () => NOW,
    }),
    callerPolicy: defaultCallerPolicy,
    rehearsalStatusProvider: {
      getStatus: () => {
        throw new Error("Not used by this fixture.");
      },
    },
    operationTelemetryReader: collector,
    allowedOrigin: APP_ORIGIN,
  });
  await new Promise<void>((resolve) =>
    apiServer.listen(0, "127.0.0.1", resolve)
  );
  const address = apiServer.address() as AddressInfo;
  apiBaseUrl = `http://127.0.0.1:${address.port}`;
  accessToken = fixtureToken({
    tid: STUDENT_TENANT_ID,
    oid: STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
    scp: REQUIRED_DELEGATED_SCOPE,
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    apiServer.close((error) => error ? reject(error) : resolve())
  );
});

test("manually loads sanitized recent operations through the local product path", async ({
  page,
}) => {
  await page.addInitScript(
    ({ apiBaseUrl, accessToken }) => {
      Object.defineProperty(window, "__AP2_LOCAL_OPERATOR__", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: { apiBaseUrl, accessToken },
      });
    },
    { apiBaseUrl, accessToken },
  );
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let readRequests = 0;
  await page.route("**/api/operation-events?order=newest", async (route) => {
    readRequests += 1;
    await requestGate;
    await route.continue();
  });

  await page.goto("/e2e/recent-operations.html");
  await expect(page.getByText("Signed in as Fixture Operator")).toBeVisible();
  const panel = page.getByRole("region", { name: "Recent operations" });
  const refresh = panel.getByRole("button", {
    name: "Refresh recent operations",
  });
  await expect(panel.getByText("Select Refresh")).toBeVisible();
  expect(readRequests).toBe(0);

  const response = page.waitForResponse((candidate) =>
    candidate.url() === `${apiBaseUrl}/api/operation-events?order=newest`
  );
  await refresh.click();
  await expect(panel.getByText("Loading recent operations…")).toBeVisible();
  await expect(refresh).toBeDisabled();
  releaseRequest();
  expect((await response).status()).toBe(200);

  await expect(panel.getByText("Calendar cancel")).toBeVisible();
  await expect(panel.getByText("Ambiguous")).toBeVisible();
  await expect(panel.getByText("Upstream Unavailable")).toBeVisible();
  await expect(panel.getByText("Possible Mutation")).toBeVisible();
  await expect(panel.getByText("1.3 seconds")).toBeVisible();
  await expect(panel.getByText("503")).toBeVisible();
  await expect(panel).not.toContainText("m1_");
  await expect(panel).not.toContainText(accessToken);
  await expect(panel).toContainText("disappear when it restarts");
  await page.waitForTimeout(100);
  expect(readRequests).toBe(1);
});

function fixtureToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({
    alg: "RS256",
    kid: KEY_ID,
    typ: "JWT",
  })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    iat: NOW - 60,
    nbf: NOW - 60,
    exp: NOW + 300,
    ...claims,
  })).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
