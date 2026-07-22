// @vitest-environment node

import { generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteJwksSigningKeyProvider } from "./jwks.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RemoteJwksSigningKeyProvider", () => {
  it("requires HTTPS unless insecure HTTP is explicitly enabled", () => {
    expect(() => new RemoteJwksSigningKeyProvider("http://fixture.example/keys")).toThrow(
      "JWKS URL must use HTTPS",
    );
  });

  it("discovers and caches an RS256 public key", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ keys: [{ ...jwk, kid: "fixture", alg: "RS256", use: "sig" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new RemoteJwksSigningKeyProvider("https://fixture.example/keys");

    const first = await provider.getSigningKey("fixture");
    const second = await provider.getSigningKey("fixture");

    expect(first).toBe(second);
    expect(first.asymmetricKeyType).toBe("rsa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://fixture.example/keys"),
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("does not refetch immediately for attacker-controlled unknown key IDs", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: "known", alg: "RS256" }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new RemoteJwksSigningKeyProvider("https://fixture.example/keys");

    await provider.getSigningKey("known");
    await expect(provider.getSigningKey("unknown-one")).rejects.toThrow("Signing key not found");
    await expect(provider.getSigningKey("unknown-two")).rejects.toThrow("Signing key not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
