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
  InMemoryTeamsMissedCallRehearsalVerificationService,
} from "./teams-missed-call-rehearsal-verification.js";
import { createApiServer } from "./server.js";
import { JoseTokenVerifier } from "./token-verifier.js";
import {
  TEAMS_MISSED_CALL_REHEARSAL_MAX_REQUEST_BYTES,
  type TeamsMissedCallRehearsalVerificationRequest,
} from "../src/api/teams-missed-call-rehearsal-verification-contract.js";

const ISSUER = "https://auth.example.test/teams-rehearsal/v2.0";
const AUDIENCE = "api://teams-rehearsal-test";
const KEY_ID = "teams-rehearsal-test-key";
const TOKEN_TIME = 2_000_000_000;
const PATH = "/api/teams-missed-call-rehearsal-verification";
const BRANCHES = [
  "stage-only",
  "native-retained",
  "reported-retained",
  "native-cleaned",
] as const;
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
const privateDocumentRehearsalVerificationService = { verify: vi.fn() };
const multiScenarioFeasibilityService = { calculate: vi.fn() };
const teamsService =
  new InMemoryTeamsMissedCallRehearsalVerificationService();
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
  privateDocumentRehearsalVerificationService,
  teamsMissedCallRehearsalVerificationService: teamsService,
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

describe("authenticated Teams missed-call rehearsal verification HTTP path", () => {
  it.each(BRANCHES)(
    "verifies the independent %s fixture deterministically without side effects",
    async (branch) => {
      const externalFetch = vi.spyOn(globalThis, "fetch");
      const output = fixture(branch);
      const first = await verificationRequest(output);
      const second = await verificationRequest(structuredClone(output));

      expect(first.status).toBe(200);
      expect(first.headers["content-type"]).toBe(
        "application/json; charset=utf-8",
      );
      expect(first.headers["cache-control"]).toBe("no-store");
      expect(first.body).toBe(second.body);
      expect(JSON.parse(first.body)).toMatchObject({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY_VERIFIED",
        status: "verified",
        scenarioId: "teams-missed-call-observation",
        planDigestSha256: output.binding!.planDigestSha256,
        fakeRunDigestSha256: output.binding!.fakeRunDigestSha256,
        syntheticBranch: branch,
        externalEvidence: "all-uninspected",
        canonicalLearnerInterpretation: "uninspected",
        claimCount: 14,
      });
      expect(first.body).not.toMatch(
        /"fakeRun":|proofReference|upstreamPayload|@|\/home\//i,
      );
      expect(externalFetch).not.toHaveBeenCalled();
      expect(scenarioPlanService.compile).not.toHaveBeenCalled();
      expect(scenarioEvidenceVerificationService.verify).not.toHaveBeenCalled();
      expect(rehearsalOutputVerificationService.verify).not.toHaveBeenCalled();
      expect(privateDocumentRehearsalVerificationService.verify)
        .not.toHaveBeenCalled();
      expect(multiScenarioFeasibilityService.calculate).not.toHaveBeenCalled();
      externalFetch.mockRestore();
    },
  );

  it("authenticates and authorizes before body bounds or reads", async () => {
    const verify = vi.spyOn(teamsService, "verify");
    verify.mockClear();
    const oversized =
      "x".repeat(TEAMS_MISSED_CALL_REHEARSAL_MAX_REQUEST_BYTES + 1);
    expect((await rawRequest(oversized, {
      "content-type": "application/json",
    })).status).toBe(401);
    expect((await rawRequest(oversized, {
      authorization: `Bearer ${signedToken({
        oid: AFTER_PARTY_CLIENT_ID,
      })}`,
      "content-type": "application/json",
    })).status).toBe(403);
    expect((await rawRequest(
      oversized,
      { ...authHeaders(), "content-type": "application/json" },
    )).status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
    verify.mockRestore();
  });

  it("bounds method, content type, encoding, malformed JSON, and request bytes", async () => {
    const body = JSON.stringify(fixture());
    expect((await rawRequest(body, authHeaders())).status).toBe(415);
    expect((await rawRequest(body, {
      ...authHeaders(),
      "content-type": "application/json; charset=utf-8",
    })).status).toBe(415);
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
      body,
      { ...authHeaders(), "content-type": "application/json" },
      PATH,
      "PUT",
    )).status).toBe(404);
  });

  it.each([
    ["PLAN_BINDING", (value: AnyRecord) => {
      nested(value, "binding").planDigestSha256 = "0".repeat(64);
    }],
    ["FAKE_CONTRACT_BINDING", (value: AnyRecord) => {
      nested(value, "binding").fakeRunDigestSha256 = "0".repeat(64);
    }],
    ["RUN_NONTERMINAL", (value: AnyRecord) => {
      value.status = "refused";
      value.failure = "fake-nonterminal";
    }],
    ["TWO_SURFACE_GAP", (value: AnyRecord) => {
      nested(value, "fakeRun").activity = "synthetic-uninspected";
    }],
    ["REPORT_CLEANUP_COUPLING", (value: AnyRecord) => {
      nested(value, "fakeRun").report = "synthetic-reported";
    }],
    ["CLEANUP_GAP", (value: AnyRecord) => {
      nested(value, "fakeRun").retention = "synthetic-retained";
    }],
    ["RECEIPT_REFUSED", (value: AnyRecord) => {
      nested(value, "receipt").candidateClaimCount = 13;
    }],
    ["EVIDENCE_OVERCLAIM", (value: AnyRecord) => {
      nested(nested(value, "envelope"), "claims").voicemail = "proven";
    }],
  ] as const)(
    "returns only the fixed %s refusal",
    async (category, mutate) => {
      const branch = category === "REPORT_CLEANUP_COUPLING" ||
          category === "CLEANUP_GAP"
        ? "native-cleaned"
        : category === "TWO_SURFACE_GAP"
        ? "native-retained"
        : "stage-only";
      const value = structuredClone(fixture(branch)) as unknown as AnyRecord;
      mutate(value);
      const response = await verificationRequest(value);
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: "teams_missed_call_rehearsal_refused",
        category,
      });
    },
  );

  it.each([
    ["unknown", "safe"],
    ["tenantId", "raw-tenant"],
    ["userId", "raw-user"],
    ["objectId", "raw-object"],
    ["resourceId", "raw-resource"],
    ["callId", "raw-call"],
    ["sessionId", "raw-session"],
    ["messageId", "raw-message"],
    ["activityId", "raw-activity"],
    ["proofReference", "raw-proof"],
  ])("rejects raw or unknown field %s before the verifier", async (key, raw) => {
    const value = fixture() as unknown as AnyRecord;
    value[key] = raw;
    expect(JSON.parse((await verificationRequest(value)).body)).toEqual({
      error: "teams_missed_call_rehearsal_refused",
      category: "INPUT_SHAPE",
    });
  });

  it.each([
    ["person", "example.test"].join("@"),
    `/${["home", "operator", "receipt.json"].join("/")}`,
    ["Bearer", "abcdefghijklmnopqrstuvwxyz"].join(" "),
    ["ap2", "teams-hidden-value"].join("-"),
    ["11111111", "1111", "1111", "1111", "111111111111"].join("-"),
  ])("rejects protected value %s before the verifier", async (raw) => {
    const value = fixture() as unknown as AnyRecord;
    value.unknown = raw;
    expect(JSON.parse((await verificationRequest(value)).body)).toEqual({
      error: "teams_missed_call_rehearsal_refused",
      category: "UNSAFE_CONTENT",
    });
  });

  it.each([
    ["schema", (value: AnyRecord) => {
      value.schemaVersion = 2;
    }],
    ["label", (value: AnyRecord) => {
      value.label = "LIVE";
    }],
    ["scenario", (value: AnyRecord) => {
      nested(value, "binding").scenarioId = "other-scenario";
    }],
    ["manifest version", (value: AnyRecord) => {
      nested(value, "binding").manifestSchemaVersion = 1;
    }],
    ["branch", (value: AnyRecord) => {
      nested(value, "binding").syntheticBranch = "live";
    }],
    ["claim cardinality", (value: AnyRecord) => {
      delete nested(nested(value, "envelope"), "claims").callback;
    }],
    ["string bound", (value: AnyRecord) => {
      nested(value, "fakeRun").report = "a".repeat(65);
    }],
  ])("rejects exact contract drift: %s", async (_name, mutate) => {
    const value = fixture() as unknown as AnyRecord;
    mutate(value);
    expect(JSON.parse((await verificationRequest(value)).body)).toEqual({
      error: "teams_missed_call_rehearsal_refused",
      category: "INPUT_SHAPE",
    });
  });

  it("rejects cross-family substitution and isolated route variants", async () => {
    const privateDocument = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
    ), "utf8"));
    expect(JSON.parse(
      (await verificationRequest(privateDocument)).body,
    )).toEqual({
      error: "teams_missed_call_rehearsal_refused",
      category: "INPUT_SHAPE",
    });
    expect((await rawRequest("{}", {
      ...authHeaders(),
      "content-type": "application/json",
    }, `${PATH}/extra`)).status).toBe(404);
  });

  it("supports only the exact protected CORS preflight", async () => {
    const accepted = await rawRequest("", {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type",
    }, PATH, "OPTIONS", false);
    expect(accepted.status).toBe(204);
    const rejected = await rawRequest("", {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers":
        "authorization, content-type, x-extra",
    }, PATH, "OPTIONS", false);
    expect(rejected.status).toBe(403);
  });

  it("does not interfere with existing protected routes", async () => {
    for (const path of [
      "/api/scenario-plan",
      "/api/scenario-evidence-verification",
      "/api/rehearsal-output-verification",
      "/api/private-document-rehearsal-verification",
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
  branch: typeof BRANCHES[number] = "stage-only",
): TeamsMissedCallRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures",
    `teams-missed-call-rehearsal-output-${branch}.json`,
  ), "utf8")) as TeamsMissedCallRehearsalVerificationRequest;
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
  method = "POST",
  includeLength = true,
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
      method,
      headers: {
        ...headers,
        ...(includeLength
          ? { "content-length": Buffer.byteLength(body) }
          : {}),
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
