// @vitest-environment node

import { generateKeyPairSync, sign } from "node:crypto";
import { request as nodeRequest } from "node:http";
import type { AddressInfo } from "node:net";
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
  InMemoryRehearsalOutputVerificationService,
} from "./rehearsal-output-verification.js";
import { createApiServer } from "./server.js";
import { JoseTokenVerifier } from "./token-verifier.js";
import {
  canonicalAvdThreeVmRehearsalOutput,
} from "../scripts/verify-avd-three-vm-rehearsal-output.js";
import {
  REHEARSAL_OUTPUT_MAX_REQUEST_BYTES,
} from "../src/api/rehearsal-output-verification-contract.js";

const ISSUER = "https://auth.example.test/rehearsal-operator/v2.0";
const AUDIENCE = "api://rehearsal-verification-test";
const KEY_ID = "rehearsal-verification-test-key";
const TOKEN_TIME = 2_000_000_000;
const PATH = "/api/rehearsal-output-verification";

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
const server = createApiServer({
  tokenVerifier: tokenVerifier(),
  callerPolicy: defaultCallerPolicy,
  rehearsalStatusProvider,
  scenarioPlanService,
  scenarioEvidenceVerificationService,
  rehearsalOutputVerificationService:
    new InMemoryRehearsalOutputVerificationService(),
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

describe("authenticated rehearsal output verification HTTP path", () => {
  it("verifies the canonical envelope deterministically with zero external calls", async () => {
    const externalFetch = vi.spyOn(globalThis, "fetch");
    const output = canonicalAvdThreeVmRehearsalOutput();
    const first = await verificationRequest(output);
    const second = await verificationRequest(structuredClone(output));

    expect(first.status).toBe(200);
    expect(first.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(first.body).toBe(second.body);
    expect(JSON.parse(first.body)).toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY_VERIFIED",
      status: "verified",
      scenarioId: "avd-three-vm-substrate",
      planDigestSha256: output.planDigestSha256,
      run: "terminal-complete",
      cleanup: "ordered-complete",
      observations: "synthetic-only",
      evidenceClaims: "all-uninspected",
      claimCount: 39,
      missingCoverageTotal: 39,
    });
    expect(first.body).not.toMatch(
      /runnerJournal|terminalInputs|proofReference|upstreamPayload|@|\/home\//i,
    );
    expect(externalFetch).not.toHaveBeenCalled();
    expect(scenarioPlanService.compile).not.toHaveBeenCalled();
    expect(scenarioEvidenceVerificationService.verify).not.toHaveBeenCalled();
    externalFetch.mockRestore();
  });

  it("authenticates and authorizes before reading the body", async () => {
    const body = JSON.stringify(canonicalAvdThreeVmRehearsalOutput());
    const missing = await rawRequest(body, {});
    const wrongActor = await rawRequest(body, {
      authorization: `Bearer ${signedToken({
        tid: STUDENT_TENANT_ID,
        oid: AFTER_PARTY_CLIENT_ID,
        scp: REQUIRED_DELEGATED_SCOPE,
      })}`,
      "content-type": "application/json",
    });

    expect(missing.status).toBe(401);
    expect(wrongActor.status).toBe(403);
  });

  it("bounds content type, encoding, malformed JSON, and request bytes", async () => {
    const body = JSON.stringify(canonicalAvdThreeVmRehearsalOutput());
    const noType = await rawRequest(body, authHeaders());
    const encoded = await rawRequest(body, {
      ...authHeaders(),
      "content-type": "application/json",
      "content-encoding": "gzip",
    });
    const malformed = await rawRequest("{", {
      ...authHeaders(),
      "content-type": "application/json",
    });
    const oversized = await rawRequest(
      "x".repeat(REHEARSAL_OUTPUT_MAX_REQUEST_BYTES + 1),
      { ...authHeaders(), "content-type": "application/json" },
    );

    expect(noType.status).toBe(415);
    expect(encoded.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(JSON.parse(malformed.body)).toEqual({
      error: "invalid_request_body",
    });
    expect(oversized.status).toBe(413);
  });

  it.each([
    {
      name: "input shape",
      category: "INPUT_SHAPE",
      mutate: (value: Record<string, unknown>) => {
        value.payload = "arbitrary";
      },
    },
    {
      name: "plan binding",
      category: "PLAN_BINDING",
      mutate: (value: Record<string, unknown>) => {
        value.planDigestSha256 = "0".repeat(64);
      },
    },
    {
      name: "run terminal state",
      category: "RUN_NONTERMINAL",
      mutate: (value: Record<string, unknown>) => {
        value.status = "unresolved";
      },
    },
    {
      name: "cleanup journal",
      category: "CLEANUP_GAP",
      mutate: (value: Record<string, unknown>) => {
        const journal = value.runnerJournal as Record<string, unknown>;
        journal.entries = Number(journal.entries) - 1;
      },
    },
    {
      name: "synthetic evidence overclaim",
      category: "OBSERVATION_OVERCLAIM",
      mutate: (value: Record<string, unknown>) => {
        const observations = value.observations as Record<string, unknown>;
        const evidence = observations.evidence as Record<string, unknown>;
        evidence.proven = Number(evidence.proven) + 1;
      },
    },
    {
      name: "receipt binding",
      category: "RECEIPT_BINDING",
      mutate: (value: Record<string, unknown>) => {
        const receipt = value.receipt as Record<string, unknown>;
        const binding = receipt.binding as Record<string, unknown>;
        binding.cleanup = "synthetic-missing";
      },
    },
    {
      name: "receipt coverage",
      category: "RECEIPT_COVERAGE",
      mutate: (value: Record<string, unknown>) => {
        const receipt = value.receipt as Record<string, unknown>;
        const coverage = receipt.missingCoverage as Record<string, unknown>;
        coverage.operations = Number(coverage.operations) - 1;
      },
    },
    {
      name: "unsafe raw identifier",
      category: "UNSAFE_CONTENT",
      mutate: (value: Record<string, unknown>) => {
        value.detail = ["person", "example.test"].join("@");
      },
    },
  ])("returns only the categorical $name refusal", async ({
    category,
    mutate,
  }) => {
    const value = structuredClone(
      canonicalAvdThreeVmRehearsalOutput(),
    ) as unknown as Record<string, unknown>;
    mutate(value);
    const response = await verificationRequest(value);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: "rehearsal_output_refused",
      category,
    });
    expect(response.body).not.toContain("person");
  });

  it("rejects the wrong schema, arbitrary label, proof reference, and reordered fields", async () => {
    const canonical = canonicalAvdThreeVmRehearsalOutput();
    const cases: Record<string, unknown>[] = [
      { ...canonical, schemaVersion: 2 },
      { ...canonical, label: "EXTERNAL_PROOF" },
      { ...canonical, proofReference: "external" },
      {
        label: canonical.label,
        schemaVersion: canonical.schemaVersion,
        ...Object.fromEntries(
          Object.entries(canonical).filter(
            ([key]) => !["label", "schemaVersion"].includes(key),
          ),
        ),
      },
    ];
    for (const value of cases) {
      const response = await verificationRequest(value);
      expect(response.status).toBe(400);
    }
  });

  it("isolates verifier exceptions without returning arbitrary text", async () => {
    const isolated = createApiServer({
      tokenVerifier: tokenVerifier(),
      callerPolicy: defaultCallerPolicy,
      rehearsalStatusProvider,
      rehearsalOutputVerificationService:
        new InMemoryRehearsalOutputVerificationService(() => {
          throw new Error("private upstream payload");
        }),
    });
    await new Promise<void>((resolve) =>
      isolated.listen(0, "127.0.0.1", resolve)
    );
    const isolatedPort = (isolated.address() as AddressInfo).port;
    const response = await rawRequest(
      JSON.stringify(canonicalAvdThreeVmRehearsalOutput()),
      { ...authHeaders(), "content-type": "application/json" },
      isolatedPort,
    );
    await new Promise<void>((resolve) => isolated.close(() => resolve()));

    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: "rehearsal_output_verification_failed",
    });
    expect(response.body).not.toContain("private upstream payload");
  });

  it("accepts only authorization and content-type in CORS preflight", async () => {
    const baseHeaders = {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
    };
    const accepted = await rawRequest("", {
      ...baseHeaders,
      "access-control-request-headers": "Authorization, Content-Type",
    }, port, "OPTIONS");
    const broader = await rawRequest("", {
      ...baseHeaders,
      "access-control-request-headers":
        "Authorization, Content-Type, X-Upstream",
    }, port, "OPTIONS");

    expect(accepted.status).toBe(204);
    expect(accepted.headers["access-control-allow-headers"]).toBe(
      "Authorization, Content-Type",
    );
    expect(broader.status).toBe(403);
  });
});

function verificationRequest(value: unknown): Promise<HttpResult> {
  return rawRequest(JSON.stringify(value), {
    ...authHeaders(),
    "content-type": "application/json",
  });
}

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${signedToken({
      tid: STUDENT_TENANT_ID,
      oid: STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
      scp: REQUIRED_DELEGATED_SCOPE,
    })}`,
  };
}

function tokenVerifier(): JoseTokenVerifier {
  return new JoseTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
    now: () => TOKEN_TIME,
  });
}

function signedToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    exp: TOKEN_TIME + 300,
    nbf: TOKEN_TIME - 10,
    ...claims,
  })).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

interface HttpResult {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}

function rawRequest(
  body: string,
  headers: Record<string, string>,
  targetPort = port,
  method = "POST",
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = nodeRequest({
      hostname: "127.0.0.1",
      port: targetPort,
      path: PATH,
      method,
      headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: {
          "content-type": response.headers["content-type"],
          "access-control-allow-headers":
            response.headers["access-control-allow-headers"],
        },
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}
