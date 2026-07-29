// @vitest-environment node

import { performance } from "node:perf_hooks";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  API_JWKS_TIMEOUT_MS,
  createRemoteTokenVerifier,
  InvalidTokenError,
} from "./token-verifier.js";

describe("createRemoteTokenVerifier", () => {
  it("requires HTTPS unless insecure HTTP is explicitly enabled", () => {
    const config = {
      issuer: "https://issuer.example/",
      audience: "api://audience",
      jwksUrl: "http://fixture.example/keys",
    };

    expect(() => createRemoteTokenVerifier(config)).toThrow(
      "JWKS URL must use HTTPS",
    );
    expect(() =>
      createRemoteTokenVerifier({ ...config, allowInsecureHttp: true }),
    ).not.toThrow();
  });

  it("fails a held JWKS read at the explicit finite boundary", async () => {
    const server = createServer((_request, _response) => {
      // Deliberately hold the local fixture response.
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Held JWKS fixture did not bind");
    }
    const issuer = "https://held-jwks.example/";
    const audience = "api://held-jwks-fixture";
    const verifier = createRemoteTokenVerifier({
      issuer,
      audience,
      jwksUrl: `http://127.0.0.1:${address.port}/jwks`,
      allowInsecureHttp: true,
    });
    const token = [
      encoded({ alg: "RS256", kid: "held-key", typ: "JWT" }),
      encoded({
        iss: issuer,
        aud: audience,
        exp: Math.floor(Date.now() / 1_000) + 60,
      }),
      Buffer.from("fixture-signature").toString("base64url"),
    ].join(".");
    const startedAt = performance.now();

    try {
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(
        InvalidTokenError,
      );
      const elapsedMs = performance.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(API_JWKS_TIMEOUT_MS - 500);
      expect(elapsedMs).toBeLessThan(API_JWKS_TIMEOUT_MS + 1_500);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 8_000);
});

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
