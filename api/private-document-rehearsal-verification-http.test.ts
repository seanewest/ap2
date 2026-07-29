// @vitest-environment node

import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as nodeRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createLocalJWKSet, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultCallerPolicy } from "./auth-policy.js";
import {
  AFTER_PARTY_CLIENT_ID,
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "./identity.js";
import {
  InMemoryPrivateDocumentRehearsalVerificationService,
} from "./private-document-rehearsal-verification.js";
import { createApiServer } from "./server.js";
import { JoseTokenVerifier } from "./token-verifier.js";
import {
  PRIVATE_DOCUMENT_REHEARSAL_MAX_REQUEST_BYTES,
  type PrivateDocumentRehearsalVerificationRequest,
} from "../src/api/private-document-rehearsal-verification-contract.js";

const ISSUER = "https://auth.example.test/private-rehearsal/v2.0";
const AUDIENCE = "api://private-rehearsal-test";
const KEY_ID = "private-rehearsal-test-key";
const TOKEN_TIME = 2_000_000_000;
const PATH = "/api/private-document-rehearsal-verification";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: KEY_ID,
  alg: "RS256",
  use: "sig",
} as JWK;
const rehearsalStatusProvider = { getStatus: vi.fn() };
const scenarioPlanService = { compile: vi.fn() };
const scenarioEvidenceVerificationService = { verify: vi.fn() };
const rehearsalOutputVerificationService = { verify: vi.fn() };
const multiScenarioFeasibilityService = { calculate: vi.fn() };
const server = createApiServer({
  tokenVerifier: new JoseTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
    now: () => TOKEN_TIME,
  }),
  callerPolicy: defaultCallerPolicy,
  rehearsalStatusProvider,
  scenarioPlanService,
  scenarioEvidenceVerificationService,
  rehearsalOutputVerificationService,
  privateDocumentRehearsalVerificationService:
    new InMemoryPrivateDocumentRehearsalVerificationService(),
  multiScenarioFeasibilityService,
  allowedOrigin: "http://localhost:5173",
});
let port: number;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("authenticated private-document rehearsal verification HTTP path", () => {
  it.each(["cleaned", "learner"] as const)(
    "verifies the captured %s fixture deterministically with zero external calls",
    async (branch) => {
      const externalFetch = vi.spyOn(globalThis, "fetch");
      const output = fixture(branch);
      const first = await verificationRequest(output);
      const second = await verificationRequest(structuredClone(output));

      expect(first.status).toBe(200);
      expect(first.body).toBe(second.body);
      expect(JSON.parse(first.body)).toEqual({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY_VERIFIED",
        status: "verified",
        scenarioId: "private-document-evidence",
        manifestSchemaVersion: 2,
        planDigestSha256: output.binding!.planDigestSha256,
        fakeRunDigestSha256: output.binding!.fakeRunDigestSha256,
        syntheticBranch: output.binding!.syntheticBranch,
        fakeContract: "ordered-terminal-verified",
        adapter: "accepted",
        receiptVerifier: "accepted",
        externalEvidence: "all-uninspected",
        claimCount: 18,
      });
      expect(first.body).not.toMatch(
        /"fakeRun":|journal|proofReference|upstreamPayload|@|\/home\//i,
      );
      expect(externalFetch).not.toHaveBeenCalled();
      expect(scenarioPlanService.compile).not.toHaveBeenCalled();
      expect(scenarioEvidenceVerificationService.verify).not.toHaveBeenCalled();
      expect(rehearsalOutputVerificationService.verify).not.toHaveBeenCalled();
      expect(multiScenarioFeasibilityService.calculate).not.toHaveBeenCalled();
      externalFetch.mockRestore();
    },
  );

  it("authenticates and authorizes before reading the body", async () => {
    const body = JSON.stringify(fixture());
    const missing = await rawRequest(body, {});
    const wrong = await rawRequest(body, {
      authorization: `Bearer ${signedToken({
        oid: AFTER_PARTY_CLIENT_ID,
      })}`,
      "content-type": "application/json",
    });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(403);
  });

  it("bounds content type, encoding, malformed JSON, and request bytes", async () => {
    const body = JSON.stringify(fixture());
    expect((await rawRequest(body, authHeaders())).status).toBe(415);
    expect((await rawRequest(body, {
      ...authHeaders(),
      "content-type": "application/json",
      "content-encoding": "gzip",
    })).status).toBe(415);
    expect((await rawRequest("{", {
      ...authHeaders(),
      "content-type": "application/json",
    })).status).toBe(400);
    expect((await rawRequest(
      "x".repeat(PRIVATE_DOCUMENT_REHEARSAL_MAX_REQUEST_BYTES + 1),
      { ...authHeaders(), "content-type": "application/json" },
    )).status).toBe(413);
  });

  it.each([
    ["INPUT_SHAPE", (value: AnyRecord) => {
      value.payload = "arbitrary";
    }],
    ["PLAN_BINDING", (value: AnyRecord) => {
      nested(value, "binding").scenarioId = "other-scenario";
    }],
    ["RUN_NONTERMINAL", (value: AnyRecord) => {
      value.status = "refused";
      value.failure = "input-schema";
    }],
    ["FAKE_CONTRACT_BINDING", (value: AnyRecord) => {
      nested(value, "binding").fakeRunDigestSha256 = "0".repeat(64);
    }],
    ["BRANCH_MISMATCH", (value: AnyRecord) => {
      nested(value, "binding").syntheticBranch = "learner-observation";
    }],
    ["CLEANUP_GAP", (value: AnyRecord) => {
      nested(value, "fakeRun").journalEntries = 29;
    }],
    ["RECEIPT_REFUSED", (value: AnyRecord) => {
      nested(value, "receipt").candidateClaimCount = 17;
    }],
    ["EVIDENCE_OVERCLAIM", (value: AnyRecord) => {
      nested(nested(value, "receipt"), "externalEvidence")
        .learnerVisibility = "proven";
    }],
    ["UNSAFE_CONTENT", (value: AnyRecord) => {
      value.detail = ["person", "example.test"].join("@");
    }],
  ] as const)(
    "returns only the fixed %s refusal",
    async (category, mutate) => {
      const value = structuredClone(fixture()) as unknown as AnyRecord;
      mutate(value);
      const response = await verificationRequest(value);
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: "private_document_rehearsal_refused",
        category,
      });
    },
  );

  it("refuses visibility-versus-terminal-absence and cross-family substitution", async () => {
    const visibility = structuredClone(fixture()) as unknown as AnyRecord;
    nested(visibility, "fakeRun").learnerObservation = "synthetic-proven";
    const avd = JSON.parse(readFileSync(
      join(process.cwd(), "scripts/fixtures/avd-three-vm-rehearsal-output.json"),
      "utf8",
    ));

    expect(JSON.parse((await verificationRequest(visibility)).body)).toEqual({
      error: "private_document_rehearsal_refused",
      category: "BRANCH_MISMATCH",
    });
    expect(JSON.parse((await verificationRequest(avd)).body)).toEqual({
      error: "private_document_rehearsal_refused",
      category: "INPUT_SHAPE",
    });
  });

  it("does not interfere with existing protected routes", async () => {
    for (const path of [
      "/api/scenario-plan",
      "/api/scenario-evidence-verification",
      "/api/rehearsal-output-verification",
      "/api/multi-scenario-feasibility",
    ]) {
      expect((await rawRequest("{}", {
        ...authHeaders(),
        "content-type": "application/json",
      }, path)).status).not.toBe(404);
    }
  });
});

type AnyRecord = Record<string, unknown>;

function fixture(
  branch: "cleaned" | "learner" = "cleaned",
): PrivateDocumentRehearsalVerificationRequest {
  const name = branch === "cleaned"
    ? "private-document-rehearsal-output-cleaned.json"
    : "private-document-rehearsal-output-learner.json";
  return JSON.parse(
    readFileSync(join(process.cwd(), "scripts/fixtures", name), "utf8"),
  ) as PrivateDocumentRehearsalVerificationRequest;
}

function nested(value: AnyRecord, key: string): AnyRecord {
  return value[key] as AnyRecord;
}

async function verificationRequest(value: unknown) {
  return rawRequest(JSON.stringify(value), {
    ...authHeaders(),
    "content-type": "application/json",
  });
}

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${signedToken({})}`,
  };
}

function signedToken(overrides: { oid?: string }): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    nbf: TOKEN_TIME - 5,
    exp: TOKEN_TIME + 300,
    tid: STUDENT_TENANT_ID,
    oid: overrides.oid ?? STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
    scp: REQUIRED_DELEGATED_SCOPE,
  })).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function rawRequest(
  body: string,
  headers: Record<string, string>,
  path = PATH,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const request = nodeRequest({
      host: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        ...headers,
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}
