// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createRemoteTokenVerifier } from "./token-verifier.js";

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
});
